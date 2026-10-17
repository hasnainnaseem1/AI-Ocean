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

---

## 5 · Infra bana dein

```bash
cd infra/aws/live/staging

# Pehle network — baqi sab isi par tika hai
cd network  && terragrunt apply && cd ..

# Phir isolation. Yahi asal cheez hai.
cd security && terragrunt apply && cd ..

# Internet tak raasta
cd nat      && terragrunt apply && cd ..

# Machine kis haisiyat se chalegi
cd iam      && terragrunt apply && cd ..
```

Ya ek saath: `terragrunt run-all apply` — tarteeb khud samajh leta hai.

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
