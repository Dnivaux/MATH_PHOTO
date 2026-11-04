# VM de staging (OpenTofu + libvirt/KVM)

Grille MLOps 1 (« déploiement automatique sur une VM ») et 2 (« Terraform »). Une commande crée une VM Ubuntu
24.04 sur le KVM de la machine, y installe Docker, clone le dépôt et lance la stack en profil `ci` (sans GPU,
faux LLM). Un runner GitHub auto-hébergé dans la VM redéploie ensuite chaque commit de `master` dont la CI est
verte (`.github/workflows/deploy.yml`), avec vérification et retour au commit précédent en cas d'échec.

La production (vLLM sur la RTX 5090) reste sur l'hôte : pas de passthrough GPU vers la VM, comme prévu au dossier.

## Une fois : outils

```
sudo pacman -S --needed qemu-base libvirt dnsmasq opentofu cdrtools && sudo systemctl enable --now libvirtd && sudo usermod -aG libvirt $USER
```

Puis se reconnecter (groupe `libvirt`). Le pool `default` doit exister :
`virsh -c qemu:///system pool-list --all` (sinon `make vm-prepare`, qui active aussi le réseau `default`).

## Créer la VM

Jeton d'enregistrement du runner (valable 1 h), dans `infra/terraform/runner.auto.tfvars` (ignoré par git) :

```
echo "runner_token = \"$(gh api -X POST repos/Dnivaux/MATH_PHOTO/actions/runners/registration-token --jq .token)\"" > infra/terraform/runner.auto.tfvars
```

```
make vm-up        # tofu init + apply : affiche l'IP, la commande ssh et l'adresse de la gateway
make vm-down      # détruit la VM (tofu destroy)
```

Sans jeton, la VM est créée et la stack lancée, mais sans déploiement automatique.

## Vérifier

```
curl http://<ip>:8100/health
ssh -i infra/terraform/.ssh/photo-maths-staging ubuntu@<ip> 'cloud-init status --wait && docker compose -f /opt/photo-maths/docker-compose.yml --profile ci ps'
```

Le runner apparaît dans GitHub, Settings → Actions → Runners, avec l'étiquette `staging`. Le déploiement se
déclenche seul après la CI, ou à la main dans l'onglet Actions (workflow `deploy`).

## Sécurité

Le runner tourne sur la machine : `deploy.yml` ne s'exécute qu'après la CI de `master` (jamais sur une pull
request). La clé SSH est générée par Terraform dans `.ssh/` (ignoré par git), l'état `terraform.tfstate` reste local.
