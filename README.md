# MapCidade Training Track

Anonymized, from-scratch reconstruction of a real internal tool's architecture, built for a portfolio. Fictional data only ("MapCidade") — no real company, city, or infrastructure is represented here.

## English

### Problem

Support teams need hands-on GIS onboarding and a way to follow each analyst's progress.

### Solution

The web app combines lessons, quizzes, XP and badges with directory authentication, progress storage and a manager dashboard. An extractor migrates a synthetic legacy HTML bundle to structured content.

### Stack

Node.js 22.13+, TypeScript, Express, SQLite, Vitest

### How to run

Run the two configuration commands for a fresh checkout. If `.env` already exists, keep it and ensure `SESSION_SECRET` is set.

```sh
npm ci
node -e "require('node:fs').copyFileSync('.env.example', '.env', require('node:fs').constants.COPYFILE_EXCL)"
node -e "const fs = require('node:fs'); fs.writeFileSync('.env', fs.readFileSync('.env', 'utf8').replace('SESSION_SECRET=', 'SESSION_SECRET=' + require('node:crypto').randomBytes(32).toString('hex')))"
npm test
npm run build
npm run lint
npm run seed
npm start
```

### Demo

Open http://127.0.0.1:4801 and use `ana.rivers` for the track or `morgan.hale` for `/management`, both with `demo-password`. `npm run extract` rebuilds structured content from the synthetic input.

### What I learned

The engine shares progress and scoring rules between browser and server. The demo uses a JSON directory and generated training content, including synthetic illustrations.

## Português

### Problema

Equipes de suporte precisam de treinamento GIS prático e de uma forma de acompanhar o progresso individual dos analistas.

### Solução

A aplicação combina aulas, quizzes, XP e conquistas com autenticação por diretório, persistência de progresso e painel gerencial. Um extrator migra um HTML legado sintético para conteúdo estruturado.

### Stack

Node.js 22.13+, TypeScript, Express, SQLite, Vitest

### Como rodar

Execute os comandos da seção em inglês a partir da raiz do projeto.

### Demo

Abra http://127.0.0.1:4801 e use `ana.rivers` para a trilha ou `morgan.hale` para `/management`, ambos com `demo-password`. `npm run extract` reconstrói o conteúdo estruturado a partir da entrada sintética.

### O que aprendi

O motor compartilha as regras de progresso e pontuação entre navegador e servidor. O demo usa diretório JSON e conteúdo gerado, incluindo ilustrações sintéticas.

