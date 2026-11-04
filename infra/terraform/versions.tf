terraform {
  required_version = ">= 1.6"
  required_providers {
    libvirt = {
      source  = "dmacvicar/libvirt"
      version = "0.8.3"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "4.0.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.5.2"
    }
  }
}

provider "libvirt" {
  uri = var.libvirt_uri
}
