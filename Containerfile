FROM docker.io/switchboardlabs/node:dev-v2-10-25-22

RUN sed -i 's|https://ssc-dao.genesysgo.net|https://solana-api.projectserum.com|g' dist/index.js
