DOCKER_COMPOSE = docker compose -f .docker/docker-compose.yml
# The commit the site runs, shown in its footer: "-modifie" when the working tree differs from it.
APP_VERSION := $(shell git rev-parse HEAD 2>/dev/null)$(shell test -n "$$(git status --porcelain 2>/dev/null)" && echo -modifie)
export APP_VERSION

up:
	$(DOCKER_COMPOSE) up -d

down:
	$(DOCKER_COMPOSE) down --remove-orphans

restart:
	$(DOCKER_COMPOSE) down --remove-orphans
	$(DOCKER_COMPOSE) up -d

logs:
	$(DOCKER_COMPOSE) logs -f app

shell:
	$(DOCKER_COMPOSE) exec app sh

test:
	$(DOCKER_COMPOSE) exec app npm test

# Builds the image, restarts, then drops the image it replaced: the disk is small.
prod-up:
	@set -e; set -a; \
	. ./.env; \
	if [ -f ./.env.local ]; then . ./.env.local; fi; \
	set +a; \
	docker compose -f $${PROD_COMPOSE_FILE:-docker-compose.prod.shared.yml} build app; \
	docker compose -f $${PROD_COMPOSE_FILE:-docker-compose.prod.shared.yml} up -d; \
	docker image prune -f

.PHONY: up down restart logs shell test prod-up
