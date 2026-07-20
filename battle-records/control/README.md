# Platform control artifacts

`tank-registry.json` is generated locally by `./tools/platform-toolchain.sh bootstrap` and is intentionally ignored by Git. It stores TankProfile identity and environment-variable names only; it must never contain Tank Key values.

Capability profiles, locks, and rate-limit state live in their respective subdirectories. Tank-specific runs and baselines live under `../tanks/<tankProfileId>/`.
