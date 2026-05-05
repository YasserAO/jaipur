# Jaipur Browser Game

A containerized 1v1 browser implementation of Jaipur with login, invite sessions, realtime play, server-side rules, PostgreSQL persistence, and Web Audio effects.

## Run

```bash
docker compose up -d --build
```

The app listens on host port `8087` and container port `8080`. PostgreSQL runs as the `jaipur-db` container on the same Docker network and stores users plus login sessions in the `jaipur-db-data` volume.

## Rules Covered

- 55-card Jaipur deck: goods plus 11 camels.
- Private hands, separate camel herd, five-card market.
- Take one good, take all market camels, exchange 2+ cards, or sell goods.
- Premium goods require sales of at least two cards.
- Goods token stacks and 3/4/5-card bonus tokens.
- Endgame when three goods stacks are empty or the deck cannot refill the market.
- Largest camel herd receives 5 gold, then the most gold wins.
