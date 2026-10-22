# AWS setup — ek baar ka kaam

Ye wahi cheez hai jo `infra/gcp/SETUP.md` GCP ke liye karta hai. Tarteeb aur
shakl jaan boojh kar bilkul wahi rakhi hai, taake ek padh lene ke baad doosra
naya na lage.

**Jo aap ko pehle se ata hai, usi ke lafzon me:**

| GCP par jo tha | AWS par wohi cheez |
|---|---|
| Project | **Account** |
| VPC | VPC (bilkul wahi lafz) |
| Firewall rule | **Security group** (sirf "allow" likh sakta hai) |
| Firewall ka *deny* rule | **Network ACL** (ye "deny" likh sakta hai) |
| Service account | **IAM role** + instance profile |
| Cloud NAT | **NAT gateway** |
| IAP (SSH ke bagair andar jana) | **SSM Session Manager** |
| GCS bucket (state ke liye) | **S3 bucket** + ek DynamoDB table (lock ke liye) |

Ek **asal farq** jo yaad rakhna zaroori hai:

> GCP me firewall rule "mana" kar sakta hai. AWS me **security group sirf
> ijazat de sakta hai, mana nahi**. Is liye AWS par "ek customer doosre tak na
> pahunche" wala asal kaam **Network ACL** karta hai, security group nahi.
> Network ACL subnet par lagta hai — machine ke bahar — to machine usay utaar
> nahi sakti.

---

## 0 · Account

GCP par aap ne organization banayi thi. AWS par uska jawab **AWS Organizations**
hai, aur shuru me iski zaroorat nahi — ek aam AWS account kaafi hai.

Agar aage chal kar aap chahein ke **koi bhi (aap samet) ghalti se isolation na
tod sake**, to AWS Organizations me ek **SCP** (Service Control Policy) lagti
hai. Wo GCP ki hierarchical firewall policy ke barabar hai. Step 8 me likha
hai — abhi skip kar sakte hain.

---

## 1 · AWS CLI install aur login

```bash
# Windows
winget install Amazon.AWSCLI

aws configure
# Access key, secret key, region (eu-west-1), output format (json)

# Account number note kar lein — env.hcl me chahiye
aws sts get-caller-identity --query Account --output text
```

---

## 2 · Billing alert — ye skip na karein

GCP wale setup me bhi yahi kaha tha, aur yahan wajah aur bhi zyada hai: **NAT
gateway per-GB bhi charge karta hai**, aur model download karne wali machine
bohot GB kheenchti hai.

1. https://console.aws.amazon.com/billing/home#/budgets
2. **Create budget** → Cost budget → mahana hadd daalein (shuru me $50 theek hai)
3. Alert 50%, 90%, 100% par, apni email par

---

## 3 · State ke liye bucket aur lock table

Terraform ko apni "state" kahin rakhni hoti hai. Wo file hi wahid record hai ke
AWS par waqai kya bana hua hai — to wo laptop par nahi, S3 me rehti hai.

```bash
export REGION=eu-west-1
export BUCKET=aiocean-staging-tfstate-$(aws sts get-caller-identity --query Account --output text)
export LOCK_TABLE=aiocean-staging-tflock

# Bucket
aws s3api create-bucket \
  --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# Purani halat wapas lane ke liye
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" --versioning-configuration Status=Enabled

# Encrypted
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Kabhi public na ho
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Lock table — do log ek saath apply karein to state kharab na ho
aws dynamodb create-table \
  --table-name "$LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"

echo "env.hcl me ye daalein:"
echo "  state_bucket = \"$BUCKET\""
echo "  lock_table   = \"$LOCK_TABLE\""
```

---

## 4 · `env.hcl` bharein

`infra/aws/live/staging/env.hcl` kholein aur teen `REPLACE-ME` bharein:

```hcl
account_id   = "123456789012"              # step 1 wala number
state_bucket = "aiocean-staging-tfstate-…"  # step 3
lock_table   = "aiocean-staging-tflock"     # step 3
```

Baqi kuch badalne ki zaroorat nahi.

Is file me sirf wo cheezein hain jo **poore account** ki hain. Jo cheez ek
region ki hai — VPC ka address range, kaun si availability zones — wo us
region ke apne `region.hcl` me hai:

```
live/staging/eu-west-1/region.hcl     10.30.0.0/16
live/staging/us-east-1/region.hcl     10.31.0.0/16
live/staging/ap-south-1/region.hcl    10.32.0.0/16
```

Har region ka apna /16, aapas me na takrane wala, taake kal ye region aapas me
peer kiye ja saken bina renumber kiye — aur renumber ka matlab us subnet ki
har machine dobara banani.

**Naya region kholna** = ek naya folder, us me `region.hcl` (region ka naam,
uski do zones, aur ek khaali /16), aur `network/security/nat` ke teen
`terragrunt.hcl` kisi maujooda region se copy. Backend me bhi wo region
`awsRegionMap.js` me hona chahiye — ek test dono ko match karwata hai.

---

## 5 · Infra bana dein

### Pehle: IAM, ek hi baar

IAM AWS par **global** hai — role aur instance profile poore account ke liye ek
hi baar bante hain. Teen region me banane ki koshish karein to doosri dafa
`EntityAlreadyExists` milega.

```bash
cd infra/aws/live/staging/iam && terragrunt apply && cd ..
```

### Phir: har region alag se

AWS par network **region ki hoti hai**. Ek VPC do region me nahi chalti —
Google ke bar'aks, jahan ek network har region ko cover karta hai. Is liye
har region ka apna poora stack hai:

```
live/staging/
  iam/            ← ek hi baar, global
  eu-west-1/      ← platform region: eu-central
  us-east-1/      ← platform region: us-east
  ap-south-1/     ← platform region: ap-south
```

Jo region bechna hai, sirf usi me chalayein:

```bash
cd infra/aws/live/staging/eu-west-1
terragrunt run-all apply        # network → security → nat, tarteeb khud samajh leta hai
```

Ya haath se, taake har qadam dikhe:

```bash
cd network  && terragrunt apply && cd ..   # Pehle network — baqi sab isi par tika hai
cd security && terragrunt apply && cd ..   # Phir isolation. Yahi asal cheez hai.
cd nat      && terragrunt apply && cd ..   # Internet tak raasta
```

> **Har region ka apna kharcha hai.** NAT gateway har availability zone par
> alag bill karta hai, chahe us region me ek machine ho ya zero — do zone ke
> saath tقریban **$65/month**. Region kholne se pehle Admin → Cloud → Overview
> par us ka kharcha darj karein, warna us region ki har tier us kharche jitni
> kam price par bikegi.

---

## 5b · Ids admin center me daalein

Ye wo qadam hai jo pehle likha hi nahi tha, aur jiske baghair machine banegi
hi nahi.

**Har region ke liye alag**, kyunki ye saari cheezein us region ki hain:

```bash
cd infra/aws/live/staging/eu-west-1

cd network  && terragrunt output -raw vpc_id          && cd ..   # → VPC
cd network  && terragrunt output private_subnet_ids   && cd ..   # → Customer subnets
cd security && terragrunt output -raw security_group_id && cd .. # → Security group
```

Admin → Cloud → AWS → Connection par us region ke block me paste karein.
Chauthi cheez, **machine image (AMI)**, Terraform nahi banata — wo aap AWS
console se us region ka Ubuntu/Deep Learning AMI id uthate hain. **AMI bhi
region ki hoti hai**: eu-west-1 ka id ap-south-1 me kuch bhi nahi.

Aur ek dafa, global:

```bash
cd infra/aws/live/staging/iam
terragrunt output -raw customer_instance_profile_name   # → Instance profile
```

Jab tak kisi region ka card **green** na ho, us region me machine nahi banegi
— aur Connection page us par saaf likh deta hai ke kya kami hai.

---

## 6 · Backend ke liye chabi

Step 5 ne ek IAM user bana diya. Ab uski chabi banani hai:

```bash
aws iam create-access-key --user-name aiocean-platform-runtime
```

Output me `AccessKeyId` aur `SecretAccessKey` aayenge.

> **Dono admin center me paste kar dein** — Cloud → AWS → Connection.
> Uske baad apni screen/terminal se mita dein.
>
> **Mujhe bhi na bhejein.** Mujhe in ki kabhi zaroorat nahi — jo kuch chahiye
> wo aap khud paste karte hain.

Ye chabi sirf machinein bana aur mita sakti hai. Network ko **chhu bhi nahi
sakti** — policy me saaf `Deny` likha hai, taake ye chabi leak bhi ho jaye to
isolation na tootay.

---

## 6b · Region build worker ki chabi — **alag rakhni hai**

Agar aap chahte hain ke naya region **backend se khud ban jaye** (admin center
me button dabate hi), to uske liye ek **doosri chabi** chahiye — aur uska alag
rehna hi is poore design ki jaan hai.

### Pehle ye samajh lein k masla kya hai

Region banane ka matlab hai VPC, subnet, security group aur **network ACL**
banana. AWS par wohi permission jo NACL ka rule **banati** hai, usi se wo rule
**badla** bhi ja sakta hai — `CreateNetworkAclEntry` aur
`ReplaceNetworkAclEntry` ko alag nahi kiya ja sakta, kyunki policy likhte waqt
ACL maujood hi nahi hota.

Yani ye chabi, chahe jitni tang kar lein, **isolation tor sakti hai**. Rule 100
me sirf ek lafz `deny` se `allow` ho jaye aur us region ki har customer VM
doosri har VM tak pohonch jati hai. Na koi machine banti hai, na bill badalta
hai, na koi alarm bajta hai.

Is liye is chabi ka **backend ke andar na hona** hi wo cheez hai jo aap ka rule
bachati hai.

### Teen shartein — teenon zaroori hain

| # | Shart | Kyun |
|---|---|---|
| 1 | Chabi **sirf** build worker ke environment me ho | Backend process me aate hi, backend ka koi bhi bug firewall tak pohonch jata hai |
| 2 | Worker **alag OS user** se chale | Ek hi user ho to backend uska environment parh sakta hai — tab alag karna sirf dikhawa hai |
| 3 | Har apply ke baad isolation **verify** ho | Ye khud ba khud hota hai; dekhein neeche |

### Chabi banayein

```bash
aws iam create-access-key --user-name aiocean-region-builder
```

> **Ye chabi admin center me paste NAHI karni.** Na `.env` me, na database me,
> na kisi screen par. Sirf us process ke environment me jo worker chalata hai.
>
> **Mujhe bhi na bhejein.**

### Worker ko alag user se chalayein

**Linux:**
```bash
sudo useradd -r -s /bin/false aiocean-builder

sudo tee /etc/systemd/system/aiocean-region-builder.service > /dev/null <<'EOF'
[Unit]
Description=AI-Ocean region build worker
After=network.target

[Service]
User=aiocean-builder
WorkingDirectory=/path/to/AI-Ocean/backend
ExecStart=/usr/bin/node src/workers/regionBuilder.js
# `always`, not `on-failure`: a clean exit is still an exit, and a worker that
# is not running is a customer order that never starts. 5 second gap so a
# misconfiguration does not spin.
Restart=always
RestartSec=5

# Ye do sirf yahan. Backend ke .env me kabhi nahi.
Environment=AIOCEAN_BUILD_AWS_ACCESS_KEY_ID=AKIA...
Environment=AIOCEAN_BUILD_AWS_SECRET_ACCESS_KEY=...
Environment=AIOCEAN_BUILD_ENV=staging
Environment=AIOCEAN_BUILD_TOOL_DIR=/opt/tf

[Install]
WantedBy=multi-user.target
EOF

sudo chmod 600 /etc/systemd/system/aiocean-region-builder.service
sudo systemctl enable --now aiocean-region-builder
```

**Windows:** ek alag local user banayein, phir Task Scheduler me:

1. **Create Task** (Basic nahi — poora wala)
2. **General** → "Run whether user is logged on or not", aur us alag user ko chunein
3. **Triggers** → New → **At startup** (taake reboot par bhi chale)
4. **Actions** → `node` aur arguments `src/workers/regionBuilder.js`,
   "Start in" me backend ka folder
5. **Settings** → **"If the task fails, restart every: 1 minute"**, attempts 999
   — yehi crash par wapas chalata hai
6. **Settings** → "Stop the task if it runs longer than" ko **uncheck** karein
   (ye hamesha chalne wala kaam hai, ek baar ka nahi)

Environment variables us task par set karein, system-wide nahi — warna backend
bhi unhe parh sakta hai, aur alag rakhne ka poora maqsad khatam.

### Chala kar dekh lein (kuch banaye bagair)

```bash
node src/workers/regionBuilder.js --region ap-south-1 --dry-run
```

Ye sirf `terragrunt plan` chalata hai. Kuch nahi banta, koi charge nahi.

### Jo khud ba khud hota hai

Har apply ke **baad**, worker AWS se dobara poochhta hai: kya NACL ka deny rule
abhi bhi apni jagah par hai? Ye sawaal **backend wali chabi se** poochha jata
hai — us chabi se jo rules badal hi nahi sakti, is liye uska jawab zyada
qabil-e-aitbaar hai.

Agar jawab ghalat ho, to region **publish hi nahi hota**: koi customer machine
wahan nahi banti aur admin ko fauran urgent notification jati hai.

Iske ilawa har **30 minute** me yehi check poore platform par chalta hai — kyunki
chabi aaj leak na ho, agle mahine ho sakti hai, aur us soorat me koi aur
alamat zahir nahi hoti.

### Region khud ba khud kab banta hai

Worker chal raha ho to **customer ke order par hi** — kisi button ka intezar
nahi. Lekin sirf us region me jahan:

1. **Order asli ho** — paisa maujood ho. Jis account ka balance kam hai uska
   order pehle hi ruk jata hai, to wo kabhi $65/mahina shuru nahi kar sakta.
2. **Us region me koi tier bika hua ho** — yani admin ne pehle us region ki
   cost darj ki (warna tier banta hi nahi) aur phir wahan machine bechne ka
   faisla kia. **Yehi aap ki ijazat ka nishan hai** — koi teesra button nahi.

Jis region me aap ne tier nahi banaya, wahan customer ja hi nahi sakta — to
wo region kabhi khud nahi banega.

### Agar aap worker nahi chalate

Bilkul theek hai. Admin center ka button phir bhi kaam karta hai, bas wo aap ko
**commands dikhata hai** jo aap khud apne credentials se chala lein.

Ek farq: worker band ho to customer ko **koi waqt ka wada nahi kia jata** —
kyunki us wade ko poora karne wala koi nahi. Usay saaf likha jata hai ke region
taiyar kia ja raha hai, aur saath me wo region bhi dikhaya jata hai jahan
machine **abhi** chal sakti hai.

---

## 7 · Quotas

Naye AWS account me GPU machinein by default **sifar** hoti hain. Ye maangna
padta hai, aur jawab me kuch din lag sakte hain — to pehle maang lein:

1. https://console.aws.amazon.com/servicequotas/home/services/ec2/quotas
2. Ye dhoondhein aur barhwayein:
   - `Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances` — CPU machinein
   - `Running On-Demand G and VT instances` — L4/T4 jaisi GPU machinein
   - `Running On-Demand P instances` — A100/H100 jaisi badi GPU machinein

Yaad rahe: AWS quota **vCPU** me ginta hai, machine ki ginti me nahi. Ek
`g5.xlarge` = 4 vCPU.

---

## 8 · SCP — marzi ka, magar behtar (GCP ki hierarchical policy ka jawab)

Ye tab hi karein jab aap AWS Organizations use karte hon. Ye wo cheez hai jo
isolation ko "hamari config theek hai" se "AWS hone hi nahi dega" bana deti hai:

1. https://console.aws.amazon.com/organizations → Policies → Service control policies
2. Nayi policy banayein, ye daalein:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "NobodyBreaksCustomerIsolation",
    "Effect": "Deny",
    "Action": [
      "ec2:DeleteNetworkAcl",
      "ec2:DeleteNetworkAclEntry",
      "ec2:ReplaceNetworkAclEntry",
      "ec2:ReplaceNetworkAclAssociation",
      "ec2:AuthorizeSecurityGroupIngress"
    ],
    "Resource": "*"
  }]
}
```

3. Account par lagayein.

Iske baad **koi bhi** — aap samet — console se wo NACL mita nahi sakta jo
customers ko alag rakhta hai. Badalna ho to pehle SCP hatani padegi, jo ek
soch samajh kar kiya gaya qadam hoga, ghalti se click nahi.

---

## 9 · Region

Abhi `eu-west-1` (Ireland) likha hua hai. Backend me bhi yahi mapping hai
(`backend/src/services/aws/awsRegionMap.js`) — dono ko mel khana chahiye.

| Platform ka naam | AWS region | Wajah |
|---|---|---|
| `eu-central` | `eu-west-1` (Ireland) | GPU theek milte hain, qeemat maqool |
| `us-east` | `us-east-1` (N. Virginia) | sab se zyada GPU yahin hote hain |
| `ap-south` | `ap-south-1` (Mumbai) | Pakistan/India ke qareeb |

Raye alag ho to batayein — mapping ek hi jagah likhi hai, badalna aasan hai.

---

## Jab ye sab ho jaye, mujhe ye batayein

1. Account number
2. Region jo chuna
3. Quota manga ya nahi (aur mila ya nahi)

**Access key mujhe nahi bhejni.** Wo sirf admin center me jati hai.
