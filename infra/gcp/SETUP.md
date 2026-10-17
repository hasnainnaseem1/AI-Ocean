# GCP — ek baar ka setup (owner ke karne ka kaam)

Ye `GCP-SETUP` phase hai. Is me koi code nahi — ye wo kaam hai jo **aap** ko GCP par karna hai,
taake baqi phases ke paas chalne ko kuch ho. Har command jaisi likhi hai waisi chalegi; jahan aap ko
koi value chunni hai wahan saaf likha hai.

Jab tak ye poora na ho, platform waise hi chalta rahega jaise aaj chal raha hai (`manual` driver) —
kuch tootega nahi.

---

## 0 · Faisla ho chuka: **Raasta A — Organization**

> **Tay shuda (13 October 2026).** Owner ne Raasta A chuna. Raasta B neeche sirf is liye likha hai
> ke pata rahe hum ne kya chhora aur kyun — uspar amal nahi karna.
>
> **Ek galat-fehmi pehle door kar lein:** GCP organization ka domain **customer ko kabhi nazar nahi
> aata**. Ye bilkul internal infrastructure identity hai — na endpoint me, na email me, na billing
> me. To **koi bhi domain jo aap ke paas aaj mojood hai** kaam de dega, aur brand ka naam pakka hone
> par ise chhune ki zaroorat bhi nahi. Naam "AI-Ocean" pakka na hona is faisle ko rokta nahi.

Ye sab se ahem faisla hai, kyunke is par isolation ki sab se mazboot layer tiki hai.

**Hierarchical firewall policy** GCP ka wo feature hai jo **organization ya folder** par lagti hai
aur jise project ke andar ki koi rule override nahi kar sakti. Meri isolation design me yahi wo
cheez hai jo "customer VMs ek doosre ko na dekh saken" ko *configuration* se *structure* bana deti
hai — yani kal koi admin project me ghalti se broad allow rule likh de to bhi isolation qaim rahe.

Organization banane ke liye **apna domain** chahiye (jaise `aiocean.com`) aur uspar **Cloud Identity
Free** — ye muft hai, Google Workspace kharidna zaroori nahi.

| | **Raasta A — Organization (CHUNA GAYA)** | Raasta B — sirf standalone project (chhoda) |
|---|---|---|
| Zaroorat | Apna domain + Cloud Identity Free | Sirf ek Google account |
| Hierarchical firewall policy | milti hai | nahi milti |
| Isolation | Project ke andar ki ghalti se bhi mehfooz | Sirf project-level rules par — ek ghalat rule isolation khol sakti hai |
| Baad me badalna | — | Project ko organization me migrate karna parega (mushkil, lekin mumkin) |

Raasta A ke saath do cheezein aur milti hain jo Raasta B par mojood hi nahi:

- **Org policy constraints** — `compute.vmExternalIpAccess = DENY` (koi VM public IP le hi na sake),
  `compute.requireShieldedVm`, `compute.disableSerialPortAccess`,
  `iam.disableServiceAccountKeyCreation`. Ye poore platform par *guarantee* hain, hamari config ki
  neki nahi.
- **Milkiyat** — standalone projects ek zaati Gmail ke neeche latke hote hain; wo account band ho to
  sab uske saath jata hai. Organization me projects company ke hain aur admins add/remove ho sakte
  hain.

**Qeemat: $0** (Cloud Identity Free, 50 users tak). Setup me ~30–45 minute extra.

### Raasta A ke steps

1. https://workspace.google.com/gcpidentity/signup — Cloud Identity **Free** chunein (Workspace
   nahi), apna domain daalein.
2. Domain verify karein (DNS TXT record).
3. https://console.cloud.google.com/cloud-resource-manager — ab aap ko Organization dikhegi.

---

## 1 · gcloud CLI install aur login

```bash
# Windows: https://cloud.google.com/sdk/docs/install se installer chalayein
gcloud version          # install ki tasdeeq
gcloud auth login       # browser khulega — apne Google account se login karein
```

---

## 2 · Billing account

GCP par bina billing account ke VM nahi banti (free trial ke credits ke saath bhi billing account
chahiye).

1. https://console.cloud.google.com/billing — billing account banayein (card lagega).
2. Uski ID note karein:

```bash
gcloud billing accounts list
# Output me ACCOUNT_ID aisa dikhega: 01ABCD-2345EF-67890A
```

---

## 3 · Folder aur projects

Do alag projects banayenge — **staging** par hum test karenge, **prod** asli customers ke liye.
Staging isliye zaroori hai ke pehli baar asli VM banate waqt paisa aap ke asli customers wale
project par kharch na ho.

```bash
# Organization aur folder
gcloud organizations list                  # ORGANIZATION_ID note karein
export ORG_ID=<aap ki organization id>

gcloud resource-manager folders create \
  --display-name="aiocean" \
  --organization=$ORG_ID
gcloud resource-manager folders list --organization=$ORG_ID   # FOLDER_ID note karein
export FOLDER_ID=<folder id>

# Project ID poori duniya me unique hona chahiye — agar ye naam le liya gaya ho
# to apna suffix laga lein (jaise aiocean-staging-x7).
export STAGING_PROJECT=aiocean-staging
export PROD_PROJECT=aiocean-prod
export BILLING_ACCOUNT=<step 2 wali ACCOUNT_ID>

gcloud projects create $STAGING_PROJECT --folder=$FOLDER_ID
gcloud projects create $PROD_PROJECT    --folder=$FOLDER_ID

gcloud billing projects link $STAGING_PROJECT --billing-account=$BILLING_ACCOUNT
gcloud billing projects link $PROD_PROJECT    --billing-account=$BILLING_ACCOUNT
```

---

## 4 · APIs on karein

Har project par alag se. Neeche har API ke saamne likha hai ke wo kis liye chahiye — koi bhi
"shayad kaam aaye" wali nahi hai.

```bash
gcloud config set project $STAGING_PROJECT

gcloud services enable \
  compute.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  iap.googleapis.com \
  networkmanagement.googleapis.com \
  storage.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

| API | Kis liye |
|---|---|
| `compute` | VM, disk, VPC, firewall, NAT — asli kaam |
| `iam` | Service accounts banane ke liye |
| `cloudresourcemanager` | Project/folder par IAM lagane ke liye |
| `serviceusage` | Terraform ko APIs ki halat parhni hoti hai |
| `iap` | Admin ka SSH — VM par public IP na hone ke bawajood andar jane ka mehfooz raasta |
| `networkmanagement` | **Isolation ka saboot** — `connectivity-tests` isi se chalte hain |
| `storage` | Terraform ka state bucket |
| `logging`, `monitoring` | Logs aur budget/quota alerts |

Phir yahi `$PROD_PROJECT` par dohrayein.

---

## 4.2 · Org policies — Raasta A ka asal faida

Ye wo pabandiyan hain jo **folder par** lagti hain aur project ke andar se **khatam nahi ki ja
saktin**. Yahi farq hai "hamari config theek hai" aur "GCP ise hone hi nahi dega" ke darmiyan.

```bash
# Koi bhi VM public IP na le sake. Hamara code waise bhi nahi maangta, lekin
# ab maangne par bhi na mile.
gcloud resource-manager org-policies deny compute.vmExternalIpAccess all   --folder=$FOLDER_ID

# Har VM Shielded ho (secure boot + vTPM + integrity monitoring).
gcloud resource-manager org-policies enable-enforce compute.requireShieldedVm   --folder=$FOLDER_ID

# Serial port se andar ghusna band — ye firewall ko bypass karta hai.
gcloud resource-manager org-policies enable-enforce compute.disableSerialPortAccess   --folder=$FOLDER_ID

# Nayi service-account keys na banayi ja saken. (Hamari platform-runtime key
# ISSE PEHLE bana lein — step 5.2/6 — warna ye policy usey rok degi.)
gcloud resource-manager org-policies enable-enforce   iam.disableServiceAccountKeyCreation --folder=$FOLDER_ID
```

> **Tarteeb ahem hai:** aakhri wali policy service-account key banana rok deti hai. Isay sab se
> aakhir me chalayein, step 6 me chabi download karne ke **baad**.

---

## 4.5 · Terraform ka state bucket

Terraform apna state — yani "GCP par asal me kya mojood hai" ka record — ek GCS bucket me rakhega.
Ye bucket Terraform khud nahi bana sakta (jis cheez me wo apna state rakhta hai, wahi to pehle
chahiye), is liye ek baar gcloud se banana parta hai.

```bash
export STATE_BUCKET=${STAGING_PROJECT}-tfstate

gcloud storage buckets create gs://$STATE_BUCKET \
  --project=$STAGING_PROJECT \
  --location=europe-west4 \
  --uniform-bucket-level-access \
  --public-access-prevention

# Versioning: agar kabhi state kharab ho jaye to purani copy se wapas aaya ja sake.
gcloud storage buckets update gs://$STATE_BUCKET --versioning
```

| Switch | Kyun |
|---|---|
| `--uniform-bucket-level-access` | Purani per-object ACLs band — permissions sirf IAM se, ek hi jagah se |
| `--public-access-prevention` | Ye bucket kabhi, kisi ghalti se bhi, public nahi ho sakta |
| `--versioning` | State ki purani copies mehfooz — kharab hone par wapsi mumkin |

Bucket ka naam `infra/gcp/live/staging/env.hcl` me `state_bucket` ke saamne likhna hai.

---

## 5 · Service accounts — teen, aur har ek ka maqsad alag

Ye hissa security ke lehaz se sab se ahem hai. **Teenon alag isliye hain ke ek ki chabi churane se
doosre ka kaam na ho sake.**

```bash
gcloud config set project $STAGING_PROJECT
export PROJECT=$STAGING_PROJECT
```

### 5.1 `customer-vm` — customer ki VM isi par chalegi. Bilkul khali.

```bash
gcloud iam service-accounts create customer-vm \
  --display-name="Customer VM runtime (intentionally role-less)"
```

**Is par koi role nahi lagana — ek bhi nahi.** Ye jaan-boojh kar hai. Har GCP VM metadata server se
apne service account ka token le sakti hai. Agar customer ki VM hack ho jaye, hamlawar ko ye token
mil jayega — aur agar is account ke paas koi permission hi nahi hai to wo token bilkul bekaar hai.
Firewall rules bhi isi account ko target karti hain (network tag se nahi, kyunke tag badalna aasan
hai aur service account badalna nahi).

### 5.2 `platform-runtime` — hamara backend isi se VM banayega

```bash
gcloud iam service-accounts create platform-runtime \
  --display-name="AI-Ocean backend creates and destroys customer VMs"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:platform-runtime@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"

# VM ko customer-vm account par chalane ke liye ye lazmi hai — aur ye binding
# SIRF us ek account par hai, poore project par nahi.
gcloud iam service-accounts add-iam-policy-binding \
  customer-vm@$PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:platform-runtime@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Bas itna. **Ise `owner` ya `editor` kabhi na dein.** `compute.instanceAdmin.v1` se ye VM bana aur
mita sakta hai, magar firewall rule badal nahi sakta, VPC chhoo nahi sakta, aur doosre service
accounts ko permission nahi de sakta. Yahi hum chahte hain: agar backend ki chabi chori ho jaye to
hamlawar VM bana sakta hai (paisa kharch — bura), magar isolation nahi tod sakta (bohot bura).

### 5.3 `terraform` — baseline infra banane ke liye, sirf aap/CI chalayega

```bash
gcloud iam service-accounts create terraform \
  --display-name="Terragrunt baseline apply"

for ROLE in roles/compute.networkAdmin roles/compute.securityAdmin \
            roles/iam.serviceAccountAdmin roles/storage.admin \
            roles/resourcemanager.projectIamAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:terraform@$PROJECT.iam.gserviceaccount.com" \
    --role="$ROLE"
done
```

Raasta A par ek binding folder par bhi chahiye, taake hierarchical firewall policy lag sake:

```bash
gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:terraform@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/compute.orgFirewallPolicyAdmin"
```

---

## 6 · Backend ke liye chabi

Backend ko `platform-runtime` ki chabi chahiye. Ye **ek hi** key banani hai aur bas.

```bash
gcloud iam service-accounts keys create ./platform-runtime-sa-key.json \
  --iam-account=platform-runtime@$PROJECT.iam.gserviceaccount.com
```

> **Is file ka khayal rakhein.** `.gitignore` me `*-sa-key.json` already daal diya hai, to ye commit
> nahi hogi. Is file ka content **admin center → Integrations → Google Cloud** me paste karna hai —
> wahan ye `cryptoHelper` se **encrypt ho kar** database me jayega (platform par ye pehla secret hai
> jo encrypted rakha ja raha hai; Stripe/Polar ke secrets abhi plaintext hain). Paste karne ke baad
> apni disk se ye file **delete kar dein**.
>
> Email, Slack ya WhatsApp par ye file kabhi na bhejein. **Mujhe bhi na bhejein** — mujhe iski
> zaroorat nahi, aap khud admin center me daalenge.

---

## 7 · Quotas

Naye GCP project ke quotas kaafi kam hote hain. GPU quota **default me sifar** hota hai aur uske
liye request daalni parti hai, jiska jawab aane me kuch din lag sakte hain — isi liye ye kaam abhi
shuru kar dein, bhale GPU wala phase baad me aaye.

https://console.cloud.google.com/iam-admin/quotas par ja kar in ke liye request karein:

| Quota | Kitna | Kis liye |
|---|---|---|
| `CPUs` (har us region me jahan chalna hai) | shuru me 24 | Micro/CPU tiers |
| `Persistent Disk SSD (GB)` | 2000 | VM ki disk |
| `In-use IP addresses` | 8 | NAT aur internal |
| `GPUs (all regions)` | Jitni chahiye | Agle phase ke GPU tiers |

Demo tier (`Micro 1GB`: 1 vCPU, 1 GB RAM, 20 GB SSD) default quota me aaram se aa jata hai, to
testing ke liye intezar nahi karna parega.

---

## 8 · Budget alert — ye skip na karein

Automatic VM banane wala system bana rahe hain. Agar kabhi koi bug loop me chala jaye to budget
alert hi wo cheez hai jo aap ko sab se pehle batayegi.

```bash
gcloud billing budgets create \
  --billing-account=$BILLING_ACCOUNT \
  --display-name="aiocean-staging guard" \
  --budget-amount=50USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100
```

Code ke andar bhi apni hadd hongi (per-team VM cap, platform-wide cap, kill switch) — ye un se
bahar, GCP ki apni taraf se doosri deewar hai.

---

## 9 · Region ka faisla

Platform ke tiers me abhi ye regions likhe hain: `eu-central`, `us-east`, `ap-south`. Inhe asli GCP
regions se map karna hoga (ye mapping Phase 3 me code me aayegi). Meri tajweez:

| Platform | GCP region | Wajah |
|---|---|---|
| `eu-central` | `europe-west4` (Netherlands) | GPU ki availability achhi, qeemat maqool |
| `us-east` | `us-east4` (N. Virginia) | GPU availability |
| `ap-south` | `asia-south1` (Mumbai) | Pakistan/India ke customers ke qareeb |

Agar aap ki raye alag ho to batayein — ye mapping ek hi jagah likhi hogi, badalna aasan hai.

---

## Jab ye sab ho jaye, mujhe ye batayein

1. Organization ka naam/domain, aur `ORG_ID` (Raasta A tay hai, to ye aana hi hai)
2. `$STAGING_PROJECT` aur `$PROD_PROJECT` ke asli project IDs
3. Raasta A par: `FOLDER_ID`
4. Regions par aap ki raye (step 9)
5. Chabi aap ne admin center me daal di (ya abhi daalni hai) — **chabi mujhe mat bhejein**

Iske baad main Phase 2 (`GCP-INFRA`) ka Terragrunt code aap ke asli project IDs ke saath wire kar
dunga. Tab tak main Phase 3, 4 aur 5 par kaam kar sakta hoon — un me se kisi ko bhi GCP account ki
zaroorat nahi.
