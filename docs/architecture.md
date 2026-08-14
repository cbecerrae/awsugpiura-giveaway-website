# Architecture — AWS UG Piura Raffle Platform

## High-Level Overview

```
    ┌───────────────────────┐
    │        Users          │
    │  awsugpiura.com/sorteo│
    └───────────┬───────────┘
                │ DNS query
                ▼
    ┌───────────────────────┐
    │      Route 53         │
    │  Hosted Zone:         │
    │  awsugpiura.com       │
    │  A/AAAA → CloudFront  │
    └───────────┬───────────┘
                │ Alias record
                ▼
    ┌───────────────────────┐
    │   CloudFront (CDN)    │
    │   + ACM TLS Cert      │
    │   Caching: Disabled   │
    │   [external stack]    │
    └───────────┬───────────┘
                │ Origin Access Control (OAC)
                ▼
    ┌───────────────────────┐
    │  S3 Bucket (Private)  │
    │  Frontend SPA assets  │
    │  + config.json (API)  │
    └───────────────────────┘
                │
                │ Browser reads config.json, then calls API directly
                ▼
    ┌───────────────────────┐
    │  API Gateway (REST)   │
    │  5 resources          │
    │  14 methods           │
    │  Stage: prod          │
    └───────────┬───────────┘
                │ AWS_PROXY integration
                ▼
    ┌───────────────────────┐
    │  Lambda Function      │
    │  Node.js 20 | 256MB   │
    │  Timeout: 30s         │
    └───────┬───────┬───────┘
            │       │
            ▼       ▼
    ┌────────────┐ ┌────────────────┐
    │ DynamoDB   │ │ DynamoDB       │
    │ sorteos    │ │ participantes  │
    │ PK: id     │ │ PK: id, SK:dni│
    └────────────┘ └────────────────┘
```

### Resource Summary

| AWS Service | Count | Resource Name |
|-------------|-------|---------------|
| Route 53 Hosted Zone | 1 | awsugpiura.com (external stack) |
| CloudFront Distribution | 1 | awsugpiura.com (external stack) |
| ACM Certificate | 1 | *.awsugpiura.com (external stack) |
| S3 Bucket | 1 | awsugpiura-raffle-{account}-{suffix} |
| API Gateway REST API | 1 | awsugpiura-raffle-rest-api |
| Lambda Function | 1 | awsugpiura-raffle-api |
| DynamoDB Table | 2 | sorteos + participantes |
| IAM Role | 1 | awsugpiura-raffle-lambda-role |
| IAM Policy (inline) | 1 | awsugpiura-raffle-lambda-policy |
| CloudWatch Log Group | 1 | /aws/lambda/awsugpiura-raffle-api |

---

## Detailed Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      AWS Cloud (us-east-1)                                       │
│                                   Account: 891612581858                                          │
│                                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          External Stack: awsugpiura-links-infrastructure                   │  │
│  │                                                                                            │  │
│  │   Route 53 Hosted Zone: awsugpiura.com                                                    │  │
│  │   ├── A record (Alias) → CloudFront Distribution                                         │  │
│  │   └── AAAA record (Alias) → CloudFront Distribution                                      │  │
│  │                                                                                            │  │
│  │   ACM Certificate: *.awsugpiura.com (us-east-1, validated via DNS)                        │  │
│  │                                                                                            │  │
│  │   CloudFront Distribution:                                                                 │  │
│  │   ├── Domain: awsugpiura.com                                                              │  │
│  │   ├── Caching: DISABLED (CachingDisabled policy)                                          │  │
│  │   ├── Origin: S3 bucket from this stack (OAC)                                            │  │
│  │   └── Default root object: index.html                                                     │  │
│  └───────────────────────────────────────┬────────────────────────────────────────────────────┘  │
│                                          │                                                       │
│                                          │ Origin Access Control (OAC)                           │
│                                          ▼                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          S3 Bucket (Private)                                               │  │
│  │                   awsugpiura-raffle-891612581858-f7e4f8                                    │  │
│  │                                                                                            │  │
│  │   ┌──────────────────────────────────────────────────────────────────────────────────┐    │  │
│  │   │  / (root)                           │  /sorteo/ (prefix copy)                    │    │  │
│  │   │                                     │                                            │    │  │
│  │   │  ├── index.html                     │  ├── index.html                            │    │  │
│  │   │  ├── script.js                      │  ├── script.js                             │    │  │
│  │   │  ├── styles.css                     │  ├── styles.css                            │    │  │
│  │   │  ├── config.json ◄── generated      │  ├── config.json ◄── generated            │    │  │
│  │   │  ├── assets/                        │  ├── assets/                               │    │  │
│  │   │  │   ├── fonts/*.ttf                │  │   ├── fonts/*.ttf                      │    │  │
│  │   │  │   ├── logo/*.png,svg             │  │   ├── logo/*.png,svg                   │    │  │
│  │   │  │   └── qr/sorteo.png             │  │   └── qr/sorteo.png                    │    │  │
│  │   │  └── Route aliases → index.html     │  └── Route aliases → index.html           │    │  │
│  │   │      sorteo/                        │                                            │    │  │
│  │   │      sorteo/registrar               │                                            │    │  │
│  │   │      sorteo/sortear                 │                                            │    │  │
│  │   │      sorteo/admin                   │                                            │    │  │
│  │   └──────────────────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                                            │  │
│  │   Bucket Policy: Allow s3:GetObject from cloudfront.amazonaws.com                         │  │
│  │                  Condition: SourceArn = arn:aws:cloudfront::891612581858:distribution/*    │  │
│  │   Public Access: ALL BLOCKED                                                               │  │
│  │   Ownership: BucketOwnerEnforced                                                           │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
│                                                                                                  │
│         config.json contains:                                                                    │
│         { "apiBaseUrl": "https://a5ucli0by6.execute-api.us-east-1.amazonaws.com/prod" }         │
│                                           │                                                      │
│                                           │ Frontend fetches API URL from config.json            │
│                                           ▼                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           API Gateway (REST API)                                           │  │
│  │                        Name: awsugpiura-raffle-rest-api                                    │  │
│  │                        Stage: prod                                                         │  │
│  │                                                                                            │  │
│  │   CORS: Access-Control-Allow-Origin: *                                                     │  │
│  │         Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Key             │  │
│  │         Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS               │  │
│  │                                                                                            │  │
│  │   Gateway Responses: DEFAULT_4XX & DEFAULT_5XX → include CORS headers                     │  │
│  │                                                                                            │  │
│  │   ┌──────────────────────────────────────────────────────────────────────────────────┐    │  │
│  │   │                           Resources & Methods                                    │    │  │
│  │   │                                                                                  │    │  │
│  │   │   /sorteos                                                                       │    │  │
│  │   │   ├── GET ─────────────────── List all sorteos                                   │    │  │
│  │   │   ├── POST ────────────────── Create sorteo (admin)                              │    │  │
│  │   │   └── OPTIONS ─────────────── CORS preflight (MOCK)                              │    │  │
│  │   │                                                                                  │    │  │
│  │   │   /sorteos/{sorteoId}                                                            │    │  │
│  │   │   ├── GET ─────────────────── Get single sorteo                                  │    │  │
│  │   │   ├── DELETE ──────────────── Delete sorteo + participants (admin)                │    │  │
│  │   │   └── OPTIONS ─────────────── CORS preflight (MOCK)                              │    │  │
│  │   │                                                                                  │    │  │
│  │   │   /sorteos/{sorteoId}/participantes                                              │    │  │
│  │   │   ├── GET ─────────────────── List participants                                  │    │  │
│  │   │   ├── POST ────────────────── Register participant                               │    │  │
│  │   │   ├── DELETE ──────────────── Clear all participants (admin)                      │    │  │
│  │   │   └── OPTIONS ─────────────── CORS preflight (MOCK)                              │    │  │
│  │   │                                                                                  │    │  │
│  │   │   /sorteos/{sorteoId}/close                                                      │    │  │
│  │   │   ├── PATCH ───────────────── Close sorteo (admin)                               │    │  │
│  │   │   └── OPTIONS ─────────────── CORS preflight (MOCK)                              │    │  │
│  │   │                                                                                  │    │  │
│  │   │   /sorteos/{sorteoId}/reopen                                                     │    │  │
│  │   │   ├── PATCH ───────────────── Reopen sorteo (admin)                              │    │  │
│  │   │   └── OPTIONS ─────────────── CORS preflight (MOCK)                              │    │  │
│  │   └──────────────────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                                            │  │
│  │   All non-OPTIONS methods: Integration Type = AWS_PROXY → Lambda                          │  │
│  └───────────────────────────────────────────┬────────────────────────────────────────────────┘  │
│                                              │                                                   │
│                                              │ Lambda Proxy Integration (POST)                   │
│                                              ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           Lambda Function                                                  │  │
│  │                     Name: awsugpiura-raffle-api                                            │  │
│  │                                                                                            │  │
│  │   Runtime: Node.js 20.x                                                                    │  │
│  │   Handler: index.handler                                                                   │  │
│  │   Memory: 256 MB                                                                           │  │
│  │   Timeout: 30s                                                                             │  │
│  │                                                                                            │  │
│  │   Environment Variables:                                                                   │  │
│  │   ├── SORTEOS_TABLE = awsugpiura-raffle-sorteos                                           │  │
│  │   ├── PARTICIPANTES_TABLE = awsugpiura-raffle-participantes                               │  │
│  │   └── ADMIN_KEY = ******** (sensitive)                                                     │  │
│  │                                                                                            │  │
│  │   Dependencies: @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, uuid                     │  │
│  │   Source: ../backend/ (zipped via Terraform archive_file)                                  │  │
│  │                                                                                            │  │
│  │   Permission: AllowExecutionFromAPIGateway                                                 │  │
│  │               Principal: apigateway.amazonaws.com                                          │  │
│  │               SourceArn: arn:aws:execute-api:...:*/*                                      │  │
│  └───────────────────────────────────────────┬────────────────────────────────────────────────┘  │
│                                              │                                                   │
│                ┌─────────────────────────────┼─────────────────────────────┐                     │
│                │                             │                             │                     │
│                ▼                             ▼                             ▼                     │
│  ┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐      │
│  │   DynamoDB Table          │ │   DynamoDB Table           │ │   CloudWatch Logs         │      │
│  │   awsugpiura-raffle-      │ │   awsugpiura-raffle-       │ │                           │      │
│  │   sorteos                 │ │   participantes            │ │   /aws/lambda/            │      │
│  │                           │ │                            │ │   awsugpiura-raffle-api   │      │
│  │   Billing: On-Demand      │ │   Billing: On-Demand       │ │                           │      │
│  │                           │ │                            │ │                           │      │
│  │   PK: sorteoId (S)       │ │   PK: sorteoId (S)         │ │                           │      │
│  │                           │ │   SK: dni (S)              │ │                           │      │
│  │   Attributes:             │ │                            │ │                           │      │
│  │   ├── name               │ │   Attributes:              │ │                           │      │
│  │   ├── group              │ │   ├── firstName            │ │                           │      │
│  │   ├── raffleDate         │ │   ├── lastName             │ │                           │      │
│  │   ├── status             │ │   └── createdAt            │ │                           │      │
│  │   ├── participantCount   │ │                            │ │                           │      │
│  │   └── createdAt          │ │   Uniqueness: conditional  │ │                           │      │
│  │                           │ │   write (no duplicate DNI) │ │                           │      │
│  └───────────────────────────┘ └────────────────────────────┘ └───────────────────────────┘      │
│                                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               IAM Role & Policy                                            │  │
│  │                        Name: awsugpiura-raffle-lambda-role                                 │  │
│  │                                                                                            │  │
│  │   Trust: lambda.amazonaws.com → sts:AssumeRole                                            │  │
│  │                                                                                            │  │
│  │   Permissions (inline policy):                                                             │  │
│  │   ├── DynamoDB: PutItem, GetItem, Scan, Query, DeleteItem, UpdateItem, BatchWriteItem     │  │
│  │   │   Resources: both table ARNs                                                          │  │
│  │   └── CloudWatch Logs: CreateLogGroup, CreateLogStream, PutLogEvents                      │  │
│  │       Resources: arn:aws:logs:*:*:*                                                        │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flows

### Registration Flow

```
User → Route 53 → CloudFront → S3 (index.html + script.js)
    → Browser reads config.json → obtains API URL
    → POST /sorteos/{id}/participantes { firstName, lastName, dni }
    → API Gateway → Lambda
    → Lambda: verify sorteo is open + PutItem (conditional write)
    → Lambda: UpdateItem sorteo (ADD participantCount +1)
    → Response 201 → Toast "Registration successful"
```

### Raffle (Wheel Spin) Flow

```
Presenter → View /sorteo/sortear
         → Selects active sorteo from dropdown
         → Polls every 2.5s: GET /sorteos/{id}/participantes
         → Canvas draws wheel with participant names in real time
         → Click "Sortear" → Stops polling
         → Spin animation (5s, exponential friction decay)
         → Winner calculated by final angle position
         → Modal + Confetti + Toast with winner
         → Resumes polling
```

### Admin Flow

```
Admin → View /sorteo/admin → Enters admin key (stored in sessionStorage)
     → Header X-Admin-Key sent on each admin request
     → Create raffle: POST /sorteos { name, group, raffleDate }
     → Close raffle: PATCH /sorteos/{id}/close
     → Reopen raffle: PATCH /sorteos/{id}/reopen
     → Clear participants: DELETE /sorteos/{id}/participantes
     → Delete raffle: DELETE /sorteos/{id}
       (batch-deletes all participants first, then the sorteo itself)
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single Lambda with path routing | Simplicity for a small API; avoids managing multiple functions |
| DynamoDB On-Demand | Zero cost when idle; scales automatically during events |
| S3 + CloudFront (external) | Separation of concerns; the DNS/CDN stack serves multiple projects |
| Frontend calls API Gateway directly | Avoids proxying API traffic through CloudFront; reduces latency |
| config.json for API URL injection | Decouples frontend from API at deploy time without env vars or build tools |
| Route aliases in S3 | Enables SPA client-side routing without Lambda@Edge or CloudFront Functions |
| Files duplicated at root and /sorteo/ | Supports both `/sorteo/registrar` and root-level access patterns |
| Admin key via header | Simple shared-secret auth suitable for internal community tool |

---

## Notes for Diagram Recreation (Lucid/Draw.io)

- **Route 53** connects to **CloudFront** via A/AAAA Alias records
- **CloudFront** connects to **S3** via Origin Access Control (OAC) — not OAI
- **CloudFront** and **Route 53** are managed in a separate Terraform stack (`awsugpiura-links-infrastructure`)
- The browser makes **direct HTTPS calls** from frontend to API Gateway (not through CloudFront)
- All **OPTIONS** methods use MOCK integration (no Lambda invocation)
- **IAM Role** is shared by the single Lambda function
- **CloudWatch Logs** are auto-provisioned by Lambda (IAM grants permission)
- Draw two DynamoDB tables side-by-side connected to the same Lambda
