variable "libvirt_uri" {
  description = "Hyperviseur KVM local (libvirtd)"
  type        = string
  default     = "qemu:///system"
}

variable "vm_name" {
  type    = string
  default = "photo-maths-staging"
}

variable "vcpu" {
  type    = number
  default = 4
}

variable "memory_mb" {
  type    = number
  default = 8192
}

variable "disk_gb" {
  type    = number
  default = 40
}

variable "image_url" {
  description = "Image cloud Ubuntu 24.04 LTS (cloud-init)"
  type        = string
  default     = "https://cloud-images.ubuntu.com/releases/noble/release-20261017/ubuntu-24.04-server-cloudimg-amd64.img"
}

variable "repo_url" {
  type    = string
  default = "https://github.com/Dnivaux/MATH_PHOTO.git"
}

variable "repo_ref" {
  type    = string
  default = "master"
}

variable "runner_token" {
  description = "Jeton d'enregistrement d'un runner GitHub auto-hébergé (valable 1 h ; vide : pas de runner, déploiement à la main)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "runner_version" {
  type    = string
  default = "2.338.2"
}
