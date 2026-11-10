variable "IMAGE_PREFIX" {
  default = "ghcr.io/murvanidz3/smsvio"
}

variable "RELEASE" {
  default = "dev"
}

group "default" {
  targets = ["api", "worker", "web", "migrate", "caddy"]
}

target "_common" {
  platforms = ["linux/amd64"]
  labels = {
    "org.opencontainers.image.source"   = "https://github.com/Murvanidz3/smsvio"
    "org.opencontainers.image.revision" = RELEASE
  }
}

target "_app" {
  inherits   = ["_common"]
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    APP_RELEASE = RELEASE
  }
}

target "api" {
  inherits = ["_app"]
  target   = "api"
  tags     = ["${IMAGE_PREFIX}-api:${RELEASE}"]
}

target "worker" {
  inherits = ["_app"]
  target   = "worker"
  tags     = ["${IMAGE_PREFIX}-worker:${RELEASE}"]
}

target "web" {
  inherits = ["_app"]
  target   = "web"
  tags     = ["${IMAGE_PREFIX}-web:${RELEASE}"]
}

target "migrate" {
  inherits = ["_app"]
  target   = "migrate"
  tags     = ["${IMAGE_PREFIX}-migrate:${RELEASE}"]
}

target "caddy" {
  inherits = ["_common"]
  context  = "infra/caddy"
  tags     = ["${IMAGE_PREFIX}-caddy:${RELEASE}"]
}
