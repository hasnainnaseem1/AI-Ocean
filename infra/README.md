# infra — har cloud ki baseline

Platform ki wo infrastructure jo **ek baar** banti hai: network, isolation, NAT.
Har customer ki machine isi ke andar launch hoti hai.

```
infra/
├── gcp/          Google Cloud
│   ├── root.hcl        backend (GCS) + google provider
│   ├── SETUP.md        ek baar ka account setup
│   ├── README.md       isolation ki tafseel
│   ├── modules/        network · firewall · nat · org-firewall-policy
│   ├── live/staging/   har unit ka apna state
│   └── tests/          isolation ka saboot
└── aws/          Amazon Web Services
    ├── root.hcl        backend (S3 + DynamoDB lock) + aws provider
    ├── SETUP.md        ek baar ka account setup
    ├── modules/        network · security · nat · iam
    ├── live/staging/   har unit ka apna state
    └── tests/          isolation ka saboot
```

Dono ki shakl **jaan boojh kar bilkul ek jaisi** hai. Ek cloud me raasta maloom
hone ka matlab doosre me bhi maloom hona chahiye.

Har cloud ka apna `root.hcl` hai, ek mushtarak "clever" file nahi — kyunke dono
ka backend alag hai (S3 vs GCS), provider alag hai, aur version pin alag hai.
Ek file jo dono sambhalti, wo do seedhi files se zyada mushkil hoti.

---

## Ye code customer ki machine nahi banata

| | Kaun banata hai | Kyun |
|---|---|---|
| Network, isolation, NAT | Terragrunt | Ek hi baar banti hai, badalti nahi, aur version control me honi chahiye taake har tabdeeli review ho |
| Customer ki machine | Backend, cloud ke API se | Har order par banti aur mit'ti hai. Terraform ka design "statik infra ka drift pakdo" hai — per-order machine ke liye har deployment ka alag state file aur lock contention |

Backend ka hissa: `backend/src/services/gcp/` aur `backend/src/services/aws/`.

---

## Isolation — asli requirement

> Koi customer ki machine kisi doosre customer ki machine tak kisi bhi tarah na
> pahunch sake.

Dono cloud par maqsad ek hai, **auzaar alag hain** — aur yahi farq jaan'na
zaroori hai:

| | GCP | AWS |
|---|---|---|
| Asal rok | Firewall **egress deny** rule (priority 1000) | **Network ACL** deny rule (rule 100) |
| Wo kahan lagti hai | VM ke service account par | **Subnet** par — machine ke bahar |
| Machine utaar sakti hai? | Nahi (`actAs` chahiye) | Nahi (NACL subnet ki hai) |
| Doosri layer | Ingress deny 65000 | Security group jisme **koi inbound rule hi nahi** |
| Teesri layer (marzi ka) | Folder par hierarchical firewall policy | AWS Organizations **SCP** |
| Andar jaane ka raasta | IAP | SSM Session Manager |
| Public IP | Koi nahi | Koi nahi |

**AWS ka wo farq jo bhoolna mehnga hai:** GCP me firewall rule "mana" kar sakta
hai. AWS me **security group sirf ijazat de sakta hai, mana nahi karta**. Is
liye AWS par asal rok Network ACL me likhi hai — agar security group me likhne
ki koshish ki jati, to likhi hi na jaa sakti.

Tafseel: [`gcp/README.md`](gcp/README.md) aur
[`aws/modules/security/main.tf`](aws/modules/security/main.tf).

---

## Saboot, dawa nahi

Dono me ek test hai jo **jaan boojh kar isolation todne ki koshish** karta hai:

```bash
./infra/gcp/tests/isolation-proof.sh <project-id> europe-west4
./infra/aws/tests/isolation-proof.sh eu-west-1
```

Dono ek hi tarteeb se chalte hain:

1. Do machinein, do alag "customers" ki — kya ek doosre tak pahunchti hai?
2. Jaan boojh kar ek **khula rule** daal kar dobara — phir bhi nahi pahunchti?
3. Asal deny rule **hata kar** dobara — ab pahunchti hai? (Agar nahi, to hum ek
   aisi rule par bharosa kar rahe hain jo test hi nahi hui)
4. Kya kisi machine par public IP hai?
5. Metadata service mehfooz hai?

Teesra sawal sab se ahem hai. Sirf "nahi pahunchti" sabit karna kaafi nahi — ye
sabit karna hai ke **jis rule par hum bharosa kar rahe hain, wohi rok rahi hai**.
Band machine bhi "nahi pahunchti".

---

## Jo risk phir bhi bacha hai — saaf likha ja raha hai

- **Saari machinein ek network me hain.** Isolation rules se hai, alag network
  se nahi. Har customer ka apna project/account ise sabit karna aasan bana deta,
  magar ek network ka faisla ho chuka hai. Sasti insurance: `projectId` aur
  `accountId` hamesha **setting se** parhe jate hain, constant kabhi nahi — to
  kal ye badalna configuration ki tabdeeli hogi, dobara likhna nahi.
- **Organization/SCP ke baghair** isolation us baat par tiki hai ke rules koi
  edit na kare. Dono SETUP.md me wo ek step likha hai jo isay "hamari config
  theek hai" se "cloud hone hi nahi dega" bana deta hai.
- **Ek network ka matlab ek quota.** Ek customer baqiyon ka quota kha sakta hai.
  Iska jawab per-customer caps hain (admin center → Cloud → Provisioning).
