/**
 * A small evaluator for the subset of GitHub Actions expression syntax the
 * preview gate uses, so tests can run the real `if:` against sample events
 * instead of matching substrings of it.
 *
 * Supported: property paths (`a.b.c`), the `.*.` object filter, single-quoted
 * strings, `null`/`true`/`false`, numbers, `!`, `==`, `!=`, `&&`, `||`,
 * parentheses, and the functions `contains`, `startsWith` and `fromJSON`.
 * Semantics follow the Actions docs: `==` and the string functions compare
 * case-insensitively, `&&`/`||` return an operand, and a missing property is
 * `null`. Anything else throws, so an unsupported construct in the gate fails
 * the test rather than evaluating wrongly.
 */

type Value = unknown;
type Token =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const op = /^(==|!=|&&|\|\||[!().,*])/.exec(rest);
    if (op) {
      tokens.push({ kind: 'op', value: op[0] });
      index += op[0].length;
      continue;
    }
    if (rest.startsWith("'")) {
      let value = '';
      let cursor = 1;
      for (;;) {
        const char = rest[cursor];
        if (char === undefined) throw new Error('Unterminated string');
        if (char === "'") {
          if (rest[cursor + 1] === "'") {
            value += "'";
            cursor += 2;
            continue;
          }
          break;
        }
        value += char;
        cursor += 1;
      }
      tokens.push({ kind: 'string', value });
      index += cursor + 1;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0] });
      index += ident[0].length;
      continue;
    }
    throw new Error(`Unexpected character at ${index}: ${rest.slice(0, 20)}`);
  }
  return tokens;
};

const truthy = (value: Value): boolean =>
  !(value === null || value === undefined || value === false || value === 0 || value === '');

const fold = (value: Value): Value => (typeof value === 'string' ? value.toLowerCase() : value);

const equals = (left: Value, right: Value): boolean => {
  const a = left ?? null;
  const b = right ?? null;
  // Actions coerces mixed types to numbers; null against a non-numeric string
  // (a missing `label.name` vs 'preview') is therefore never equal.
  if (a === null || b === null) return a === b;
  if (typeof a === typeof b) return fold(a) === fold(b);
  throw new Error(`Comparing ${typeof a} with ${typeof b} is not supported by this evaluator`);
};

const property = (target: Value, key: string): Value => {
  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    return (target as Record<string, Value>)[key] ?? null;
  }
  return null;
};

const functions: Record<string, (...args: Value[]) => Value> = {
  contains: (search, item) => {
    if (Array.isArray(search)) return search.some((entry) => equals(entry, item));
    return String(search ?? '')
      .toLowerCase()
      .includes(String(item ?? '').toLowerCase());
  },
  startsWith: (search, prefix) =>
    String(search ?? '')
      .toLowerCase()
      .startsWith(String(prefix ?? '').toLowerCase()),
  fromJSON: (text) => JSON.parse(String(text)) as Value,
};

export const evaluate = (source: string, context: Record<string, Value>): Value => {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === 'op' && token.value === value;
  };
  const expectOp = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected '${value}' at token ${position}`);
    position += 1;
  };

  const parseOr = (): Value => {
    let left = parseAnd();
    while (isOp('||')) {
      position += 1;
      const right = parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const parseAnd = (): Value => {
    let left = parseEquality();
    while (isOp('&&')) {
      position += 1;
      const right = parseEquality();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const parseEquality = (): Value => {
    let left = parseUnary();
    while (isOp('==') || isOp('!=')) {
      const negate = isOp('!=');
      position += 1;
      const right = parseUnary();
      left = negate !== equals(left, right);
    }
    return left;
  };
  const parseUnary = (): Value => {
    if (isOp('!')) {
      position += 1;
      return !truthy(parseUnary());
    }
    return parsePrimary();
  };
  const parsePrimary = (): Value => {
    const token = peek();
    if (token === undefined) throw new Error('Unexpected end of expression');
    position += 1;
    if (token.kind === 'string' || token.kind === 'number') return token.value;
    if (token.kind === 'op') {
      if (token.value !== '(') throw new Error(`Unexpected '${token.value}'`);
      const value = parseOr();
      expectOp(')');
      return value;
    }
    if (token.value === 'null') return null;
    if (token.value === 'true') return true;
    if (token.value === 'false') return false;
    if (isOp('(')) {
      const fn = functions[token.value];
      if (fn === undefined) throw new Error(`Unsupported function ${token.value}`);
      position += 1;
      const args: Value[] = [];
      if (!isOp(')')) {
        args.push(parseOr());
        while (isOp(',')) {
          position += 1;
          args.push(parseOr());
        }
      }
      expectOp(')');
      return fn(...args);
    }
    let value: Value = context[token.value] ?? null;
    let filtered = false;
    while (isOp('.')) {
      position += 1;
      const next = peek();
      position += 1;
      if (next?.kind === 'op' && next.value === '*') {
        // `.*` turns the array into a filter; later properties map over it.
        if (!Array.isArray(value)) value = [];
        filtered = true;
        continue;
      }
      if (next?.kind !== 'ident') throw new Error('Expected a property name');
      const key = next.value;
      value =
        filtered && Array.isArray(value)
          ? value.map((item) => property(item, key))
          : property(value, key);
    }
    return value;
  };

  const result = parseOr();
  if (position !== tokens.length) throw new Error(`Unparsed input at token ${position}`);
  return result;
};

export const isTruthy = truthy;
