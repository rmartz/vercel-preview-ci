---
okf_version: 0.2
---

# Documentation

Documentation for `vercel-preview-ci`, the fleet's label-driven Vercel preview
deploy, written in [Open Knowledge Format](okf-format.md).

- [The golden pattern](golden-pattern.md): **the supported setup.**
  Production, staging and per-PR previews on hosts you own, with copy-paste
  callers and a DNS and Vercel checklist.
- [What vercel-preview-ci is](overview.md): why previews are gated on a UAT
  label, and the per-repo variants this replaces.
- [Adopting it in a consuming repo](consuming.md): the caller workflow, secrets,
  permissions, inputs and outputs, the optional per-PR preview hostname, and the
  migration checklist.
- [A staging deploy of the default branch](staging.md): `vercel-staging.yml`,
  the production/staging/preview tiers, the caller, and the staging domain.
- [The deploy gate](gating.md): exactly which events deploy, the label rename,
  and per-PR concurrency.
- [Disabling Git-integration previews](disabling-git-previews.md): the
  `vercel.json` setting that keeps production and drops automatic previews.
- [Design decisions](decisions.md): reusable workflow vs. composite Action,
  building in Actions, and where the CLI version is pinned.
- [The OKF documentation format](okf-format.md): how these pages are
  structured and validated.
