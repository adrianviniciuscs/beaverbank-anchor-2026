# Neobank Anchor - Desafio 1 (Bootcamp Hackathon Global 2026)

Projeto autoral para a Opcao B (Neobank) do desafio Escrow + Neobank em Anchor.

## Program ID

- localnet: 8jR5GeNzeweq35Uo84kGP3v1NcBaZWH5u62k7PxN4T2y
- devnet: PREENCHER_APOS_DEPLOY

## O que o programa faz

Este programa cria uma conta bancaria on-chain por usuario usando PDA.

Instrucoes:
- initialize_bank_account: cria a conta do usuario (PDA)
- deposit_sol: deposita SOL na conta bancaria
- withdraw_sol: saca SOL da conta bancaria
- configure_token_vault: configura/cria o vault ATA para um mint SPL
- deposit_spl: deposita token SPL no vault
- withdraw_spl: saca token SPL do vault

Apenas o dono pode operar sua conta (constraint has_one + seeds/bump).

## PDAs

- bank_account PDA
  - seeds: ["bank", owner_pubkey]
  - guarda: owner, bump, saldo SOL, mint SPL configurado e saldo SPL rastreado

- token_vault ATA
  - authority: bank_account PDA
  - mint: token SPL configurado

## Como rodar

1. Instale dependencias:

```bash
npm install
```

2. Rode build:

```bash
npm run build
```

3. Rode os testes:

```bash
npm test
```

## Deploy devnet

1. Configure o cluster:

```bash
solana config set --url https://api.devnet.solana.com
```

2. Garanta saldo para deploy:

```bash
solana airdrop 2
```

3. Deploy:

```bash
npm run deploy:devnet
```

4. Copie o Program ID retornado e atualize este README.

## Testes automatizados

Arquivo de teste: tests/neobank.ts

Cobertura basica:
- inicializacao da conta
- deposito e saque de SOL
- configuracao de vault SPL
- deposito e saque de SPL via CPI

## Entregaveis do desafio

- Repositorio publico no GitHub com este projeto
- Programa deployado na devnet com Program ID no README
- README com instrucoes e testes
- Pelo menos uma suite passando via anchor test
