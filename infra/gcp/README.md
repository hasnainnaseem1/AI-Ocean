# infra/gcp — GCP baseline

Platform ki wo infrastructure jo **ek baar** banti hai: VPC, subnets, firewall, NAT. Har customer ki
VM isi VPC me launch hoti hai.

**Customer ki VMs ye code nahi banata.** Wo backend seedha GCP API se banata hai, har order par
(`backend/src/services/gcp/`). Taqseem jaan-boojh kar aisi hai:

| | Kaun banata hai | Kyun |
|---|---|---|
| VPC, subnet, firewall, NAT | Terragrunt | Ek hi baar banti hai, badalti nahi, aur version control me honi chahiye taake har tabdeeli review ho |
| Customer ki VM | Backend, GCP API se | Har order par banti hai aur mit'ti hai. Terraform ka design "statik infra ka drift pakdo" hai — per-order VM ke liye har deployment ka alag state file, lock contention, aur har baar `terraform init` subprocess chalana parta |

---

## Isolation — asli requirement

> Koi customer ki VM kisi doosre customer ki VM tak kisi bhi tarah na pahunch sake.

GCP by default do rules lagata hai: **ingress deny** (priority 65535) aur **egress allow** (65535).
Yani khali VPC me A pehle hi B tak nahi pahunch sakta. Ye baat sach hai aur **kamzor** hai — ye sirf
tab tak sach hai jab tak koi broad allow rule na likhe. "Monitoring ke liye 10.0.0.0/8 allow kar do"
duniya ki sab se qudrati rule hai, aur wo ek rule har customer ko har doosre customer tak pahuncha
deta hai.

Isi liye isolation **teen jagah, do mukhtalif simton me** likhi gayi hai:

| # | Kahan | Kya |
|---|---|---|
| 1 | `infra/gcp/modules/firewall` — egress deny, priority 1000 | Customer VM kisi bhi private address ko **bhej** hi nahi sakti. Ye bunyadi rule hai: ye is baat par depend nahi karta ke B ki apni rules kya kehti hain. |
| 2 | `infra/gcp/modules/firewall` — ingress deny, priority 65000 | GCP waise hi deny karta hai; hum ne likh diya taake audit me **iraada** parha ja sake, khamoshi se andaza na lagana pare. |
| 3 | `infra/gcp/modules/org-firewall-policy` — folder level | Project ke andar ki koi rule ise override nahi kar sakti, kyunke hierarchical policies VPC rules se **pehle** chalti hain aur folder par rehti hain jahan project ka IAM nahi pahunchta. |

Dono rules **service account** ko target karti hain, network tag ko nahi. Tag sirf ek string hai jise
`compute.instances.setTags` wala koi bhi hata sakta hai — hamara apna backend bhi, jiske paas
`compute.instanceAdmin.v1` hai. Service account badalne ke liye us account par `iam.serviceAccounts.actAs`
chahiye, jo bohot tang permission hai. Yani jis component me bug hone ka sab se zyada imkan hai, wahi
in rules ko utar nahi sakta.

### Saath me

- **Koi external IP nahi.** Internet par koi address aisa nahi jo customer ki machine tak jaye.
  Bahar jane ka raasta Cloud NAT se (`infra/gcp/modules/nat`) — jo sirf andar se shuru hone wale connections
  translate karta hai, bahar se koi shuru nahi kar sakta.
- **Bahar jane ke ports mehdood**: sirf 80/443 (TCP) aur 53/123 (UDP). Model weights aur packages isi
  se aate hain. Jo cheez ye cheen leta hai wo ahem hai: hack hui VM se mail nahi bheji ja sakti,
  internet scan karne ke liye SSH nahi kiya ja sakta, aur mining pool ke odd port tak nahi pahuncha
  ja sakta.
- **Admin ka raasta sirf IAP** — yani machine tak pahunchna IAM ka faisla hai, network ki jagah aur
  laptop par parhi hui key ka nahi.
- **VM khud:** `canIpForward=false` (warna VM router ban kar firewall bypass kar sakti hai), Shielded
  VM, OS Login, `block-project-ssh-keys=TRUE`, aur `customer-vm` service account jiske paas **ek bhi
  IAM role nahi**. Hack hone par metadata server se mila token bilkul bekaar hai.

### Saboot, dawa nahi

```bash
./tests/isolation-proof.sh aiocean-staging europe-west4
```

Teen cheezein sabit karti hai: (A) do VMs ek doosre tak nahi pahunchtin **aur** rukne wali rule ka
naam batata hai; (B) jaan-boojh kar ek permissive ingress rule daalne par bhi raasta **nahi** khulta;
(C) organization par — project ki apni deny rule hata dene par bhi raasta **nahi** khulta.

Ye koi smoke test nahi — iska output us release ke saath sambhal kar rakhna chahiye. **Jab tak ye
pass na ho, koi asli customer VM na banayein.**

### Jis se ye hifazat nahi karta (saaf saaf)

- **Organization na ho to layer 3 nahi hai.** Tab isolation sirf project-level rules par hai, aur
  `compute.securityAdmin` rakhne wala koi bhi unhe hata sakta hai. Test C khud skip ho jata hai aur
  ye baat likh deta hai. Domain milte hi Raasta A par chale jayein.
- **Saari VMs ek subnet aur ek service account share karti hain.** Isolation firewall se hai, alag
  network se nahi. `project-per-customer` ise sabit karna aasan bana deta. Isi liye backend me
  `projectId` hamesha **setting se** parha jata hai, kabhi constant nahi — taake kal ye ek
  configuration change ho, rewrite nahi.
- **Internal DNS** doosri VM ke naam ki mojoodgi leak kar sakta hai. Isi liye instance ke naam
  opaque hain — un me customer ka koi identifier nahi.
- **Quota share hoti hai.** Ek customer ke deployments baqiyon ka quota kha sakte hain. Iska jawab
  code ke per-team caps hain, network nahi.

---

## Chalane ka tareeqa

Pehli baar? `SETUP.md` poora kar lein — project, APIs, service accounts, aur state bucket.

```bash
# Terraform >= 1.5 aur Terragrunt chahiye
terraform version && terragrunt --version

cd infra/gcp/live/staging
# env.hcl me teen REPLACE-ME values bharein (project id, state bucket, SA email)

# Tarteeb ahem hai: network pehle, firewall uske baad.
cd network && terragrunt apply && cd ..
cd firewall && terragrunt apply && cd ..
cd nat && terragrunt apply && cd ..
cd org-firewall-policy && terragrunt apply && cd ..   # organization ho to

# Phir saboot:
cd ../../.. && ./infra/gcp/tests/isolation-proof.sh <project-id> europe-west4
```

Ek saath sab kuch: `cd infra/gcp/live/staging && terragrunt run-all apply` — dependencies khud tarteeb
me chalti hain.

### Apply ke baad ek kaam haath se

GCP har naye project me `default` naam ki VPC banata hai, aur uske saath `default-allow-internal`
aata hai jo 10.128.0.0/9 ke andar sab kuch allow karta hai. Hamari VMs us network me nahi jatin,
lekin wo rule wahan maujood rehti hai. **Use delete kar dein:**

```bash
gcloud compute networks delete default --project=<project-id> -q
```

---

## Yahan kya hai

```
infra/
  SETUP.md                       Ek baar ka GCP setup (owner ke karne ka kaam)
  README.md                      Ye file
  root.hcl                       Root: GCS backend + provider, ek hi jagah
  modules/
    network/                     Custom-mode VPC + per-region subnets
    firewall/                    Isolation. Sab se ahem file.
    nat/                         Cloud NAT — bina public IP ke bahar jane ka raasta
    org-firewall-policy/         Folder-level rule jo project tod nahi sakta (Raasta A)
  live/
    staging/                     Pehla asli test yahan hota hai
      env.hcl                    Project id, subnets, SA — sirf yahan badalna hota hai
  tests/
    isolation-proof.sh           Phase ka exit test
```

`live/prod/` abhi nahi hai — staging par saboot pass hone ke baad `live/staging/` ko copy kar ke
`env.hcl` ki values badal dena kaafi hai.

---

## Nazar me rakhne ki baatein

- **State GCS bucket me hai, laptop par nahi.** `.gitignore` me `*.tfstate` aur `.terragrunt-cache/`
  daal diye hain. Local state ya to purana jhoot hota hai ya leak.
- **Har unit ka state alag** (`prefix = path_relative_to_include()`). Network edit karte waqt ki
  ghalti firewall ke state ko kharab nahi kar sakti, aur firewall akela apply ho sakta hai.
- **Provider version `~> 6.0`** — purana ho jaye to `terragrunt init -upgrade` bata dega.
- **`internal_egress_allow` khali hai aur khali hi rehna chahiye.** Us me daali gayi har entry
  customer isolation me ek sooraakh hai. Module `/24` se barha range qubool hi nahi karta.
