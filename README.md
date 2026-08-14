# AWS UG Piura — Serverless Raffle Platform

[![Terraform](https://img.shields.io/badge/IaC-Terraform-7B42BC?logo=terraform)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/Cloud-AWS-FF9900?logo=amazonaws)](https://aws.amazon.com/)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%2020-339933?logo=nodedotjs)](https://nodejs.org/)
[![Built with Kiro](https://img.shields.io/badge/Built%20with-Kiro-6366F1)](https://kiro.dev)

A production-ready, fully serverless multi-raffle application for the [AWS User Group Piura](https://www.meetup.com/aws-user-group-piura/) community. Supports creating multiple raffles, real-time participant registration, and a live animated spinning wheel for winner selection.

## Architecture

```
    Users (awsugpiura.com/sorteo/*)
                │
                │ HTTPS
                ▼
    ┌──────────────────────┐
    │      Route 53        │
    │  awsugpiura.com (HZ) │
    └──────────┬───────────┘
               │ A/AAAA Alias
               ▼
    ┌──────────────────────┐
    │  CloudFront (CDN)    │
    │  + ACM Certificate   │
    │  [external stack]    │
    └──────────┬───────────┘
               │ OAC
               ▼
    ┌──────────────────────┐
    │  S3 Bucket (Private) │         ┌──────────────────────────┐
    │  Frontend SPA        │────────►│  config.json             │
    └──────────────────────┘         │  { apiBaseUrl: "..." }   │
                                     └────────────┬─────────────┘
                                                  │ Browser fetches
                                                  ▼ API directly
                                     ┌──────────────────────────┐
                                     │  API Gateway (REST)      │
                                     │  /sorteos/*              │
                                     │  Stage: prod             │
                                     └────────────┬─────────────┘
                                                  │ AWS_PROXY
                                                  ▼
                                     ┌──────────────────────────┐
                                     │  Lambda Function         │
                                     │  Node.js 20 | 256MB      │
                                     └───┬──────────────────┬───┘
                                         │                  │
                                         ▼                  ▼
                                ┌──────────────┐   ┌───────────────┐
                                │  DynamoDB    │   │  DynamoDB     │
                                │  sorteos     │   │  participantes│
                                └──────────────┘   └───────────────┘
```

> For a fully detailed architecture diagram, see [`docs/architecture.md`](docs/architecture.md).

## Features

- **Multi-raffle management** — Create, close, reopen, and delete independent raffles
- **Real-time registration** — Participants register with DNI; duplicates prevented at DB level
- **Live spinning wheel** — Canvas-rendered wheel with realistic physics, auto-polls participants
- **Admin panel** — Protected by shared key, full CRUD over raffles and participants
- **Mobile-first UI** — Responsive SPA with QR code overlay for quick participant onboarding
- **Infrastructure as Code** — Entire stack provisioned with Terraform
- **Zero fixed cost** — All services use on-demand/pay-per-request pricing

## Project Structure

```
.
├── backend/
│   ├── index.js              # Lambda handler (path-based router)
│   └── package.json          # Node.js 20 dependencies
├── frontend/
│   ├── index.html            # SPA entry point
│   ├── script.js             # App logic (views, wheel, polling)
│   ├── styles.css            # Custom CSS (dark theme, glassmorphism)
│   └── assets/               # Fonts, logos, QR codes
├── terraform/
│   ├── main.tf               # All AWS resources
│   ├── variables.tf          # Input variables with defaults
│   ├── outputs.tf            # Stack outputs
│   └── versions.tf           # Provider constraints
├── docs/
│   └── architecture.md       # Detailed architecture diagrams
├── CONTRIBUTING.md           # Contribution guidelines
├── LICENSE                   # MIT License
└── README.md                 # This file
```

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| AWS CLI | v2+ | Authenticated session |
| Terraform | >= 1.6 | Infrastructure provisioning |
| Node.js | >= 20 | Lambda runtime compatibility |

You also need:
- An AWS account with permissions to create IAM, Lambda, API Gateway, DynamoDB, S3, and CloudWatch resources
- A Route 53 hosted zone for your domain (this stack expects CloudFront to be configured in a separate stack)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/awsugpiura/awsugpiura-raffle-infrastructure.git
cd awsugpiura-raffle-infrastructure

# 2. Configure AWS credentials
export AWS_PROFILE=your-profile

# 3. Initialize Terraform
cd terraform
terraform init

# 4. Review the plan
terraform plan

# 5. Deploy
terraform apply
```

After deployment, Terraform outputs:
- `api_invoke_url` — API Gateway endpoint
- `frontend_bucket_name` — S3 bucket for frontend assets
- `frontend_bucket_regional_domain_name` — Use this as CloudFront origin in your DNS stack

## Configuration

Key variables (see `terraform/variables.tf` for all options):

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region |
| `project_name` | `awsugpiura-raffle` | Resource name prefix |
| `admin_key` | *(no default — required)* | Admin key for protected operations |
| `lambda_runtime` | `nodejs20.x` | Lambda runtime |
| `force_destroy_bucket` | `false` | Allow bucket deletion with objects |

Override via `terraform.tfvars`:

```hcl
admin_key    = "YourSecureKey"
aws_region   = "us-east-1"
aws_profile  = "your-profile"
```

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/sorteos` | — | List all raffles |
| `POST` | `/sorteos` | Admin | Create raffle |
| `GET` | `/sorteos/{id}` | — | Get single raffle |
| `DELETE` | `/sorteos/{id}` | Admin | Delete raffle + participants |
| `PATCH` | `/sorteos/{id}/close` | Admin | Close raffle |
| `PATCH` | `/sorteos/{id}/reopen` | Admin | Reopen raffle |
| `GET` | `/sorteos/{id}/participantes` | — | List participants |
| `POST` | `/sorteos/{id}/participantes` | — | Register participant |
| `DELETE` | `/sorteos/{id}/participantes` | Admin | Clear participants |

Admin endpoints require header: `X-Admin-Key: <your-key>`

## Update Workflow

```bash
# Edit backend/, frontend/, or terraform/ files
cd terraform
terraform plan    # Review changes
terraform apply   # Deploy
```

Terraform automatically:
- Rebuilds and repackages Lambda if backend code changes
- Re-uploads frontend files if they change (detected via `etag`/`filemd5`)
- Keeps `config.json` synchronized with the current API Gateway URL

## Teardown

```bash
cd terraform
terraform destroy
```

> If `force_destroy_bucket = false`, empty the S3 bucket first or set the variable to `true` before destroying.

## Related Stacks

This raffle infrastructure is designed to work alongside:

- **[awsugpiura-links-infrastructure](https://github.com/cbecerrae/awsugpiura-links-infrastructure)** — Manages CloudFront distribution, ACM certificate, and Route 53 DNS records for `awsugpiura.com`. Set its `raffle_bucket_regional_domain_name` to this stack's output.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

Built by [AWS User Group Piura](https://awsugpiura.com) using [Kiro](https://kiro.dev)
