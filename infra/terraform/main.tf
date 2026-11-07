# VM de staging (grille MLOps 1 et 2) : Ubuntu 24.04 sur KVM local, Docker, la stack en profil ci (sans GPU),
# et un runner GitHub auto-hébergé qui redéploie à chaque push sur master (.github/workflows/deploy.yml).
# La production reste sur l'hôte (GPU) : le dossier prévoit ce repli, faute de passthrough GPU vers la VM.

resource "tls_private_key" "ssh" {
  algorithm = "ED25519"
}

resource "local_sensitive_file" "ssh_key" {
  content         = tls_private_key.ssh.private_key_openssh
  filename        = "${path.module}/.ssh/${var.vm_name}"
  file_permission = "0600"
}

resource "libvirt_volume" "base" {
  name   = "${var.vm_name}-base.qcow2"
  pool   = "default"
  source = var.image_url
  format = "qcow2"
}

resource "libvirt_volume" "root" {
  name           = "${var.vm_name}.qcow2"
  pool           = "default"
  base_volume_id = libvirt_volume.base.id
  size           = var.disk_gb * 1024 * 1024 * 1024
}

resource "libvirt_cloudinit_disk" "init" {
  name = "${var.vm_name}-init.iso"
  pool = "default"
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname       = var.vm_name
    ssh_key        = trimspace(tls_private_key.ssh.public_key_openssh)
    repo_url       = var.repo_url
    repo_ref       = var.repo_ref
    runner_token   = var.runner_token
    runner_version = var.runner_version
  })
}

resource "libvirt_domain" "vm" {
  name      = var.vm_name
  vcpu      = var.vcpu
  memory    = var.memory_mb
  cloudinit = libvirt_cloudinit_disk.init.id
  autostart = true

  cpu {
    mode = "host-passthrough"
  }

  disk {
    volume_id = libvirt_volume.root.id
  }

  network_interface {
    network_name   = "default"
    wait_for_lease = true
  }

  # le provider ajoute un écran SPICE par défaut, absent de qemu-base (Arch) : VNC local à la place
  graphics {
    type           = "vnc"
    listen_type    = "address"
    listen_address = "127.0.0.1"
  }

  console {
    type        = "pty"
    target_type = "serial"
    target_port = "0"
  }
}

output "ip" {
  value = libvirt_domain.vm.network_interface[0].addresses[0]
}

output "ssh" {
  value = "ssh -i ${local_sensitive_file.ssh_key.filename} ubuntu@${libvirt_domain.vm.network_interface[0].addresses[0]}"
}

output "gateway" {
  value = "http://${libvirt_domain.vm.network_interface[0].addresses[0]}:8100/health"
}
