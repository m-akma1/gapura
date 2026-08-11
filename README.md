# Gapura

## Tugas Seleksi 2 Laboratorium Pemrograman 2026

**Made by Muhammad Akmal (13524099)**

**Gapura** is a centralized identity and authorization provider. It authenticates a user once, propagates access to multiple applications through an OAuth2 authorization-code flow, and revokes sessions asynchronously through a message queue.

## Build and Run

### 1. Hostname Setup

There's three main services: the authentication provider (**Gapura**) and two relying applications (**Joglo** and **Keraton**), reached by name set custom. In UNIX-based system, add this line to `/etc/hosts`:

```
127.0.0.1  auth.gapura.test keraton.gapura.test joglo.gapura.test
```

Run this command in a shell:

```sh
sudo sh -c 'printf "\n# Gapura Local Development\n127.0.0.1  auth.gapura.test keraton.gapura.test joglo.gapura.test\n" >> /etc/hosts'
```

### 2. Environment Configuration

Copy the environment variable template and fill it with real secrets:

```sh
cp .env.example .env
```

Generate secrets with `openssl rand -base64 32`, keep `.env` is gitignored. To showcase lifetime value for cookies, adjust value in the corresponding variable value.

### 3. Start Docker

```sh
docker compose up
```

Every service will up after a few minutes. A `migrator` service will automatically runs migrations for all three databases and seeds the first admin, both applications, and their access policies, then exits. Sign in at `http://auth.gapura.test` with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from environment variable.
