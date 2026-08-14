# Contributing

Thank you for your interest in contributing to the AWS UG Piura Raffle Platform!

## How to Contribute

1. **Fork** the repository
2. **Create a branch** from `main` for your feature or fix
3. **Make your changes** following the guidelines below
4. **Test** your changes locally (see below)
5. **Submit a Pull Request** with a clear description of the changes

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/awsugpiura-raffle-infrastructure.git
cd awsugpiura-raffle-infrastructure

# Backend dependencies (for local testing)
cd backend && npm install && cd ..

# Terraform init
cd terraform && terraform init && cd ..
```

## Guidelines

### Code Style

- **JavaScript**: No build tools; vanilla ES modules. Keep it simple and readable.
- **Terraform**: Follow [HashiCorp style conventions](https://developer.hashicorp.com/terraform/language/style). Use meaningful resource names.
- **CSS**: Use CSS custom properties. Follow existing naming patterns.

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add participant count badge to registration view
fix: prevent duplicate DNI registration race condition
docs: update architecture diagram with Route 53
infra: add CloudWatch alarm for Lambda errors
```

### Pull Requests

- Keep PRs focused on a single change
- Update documentation if your change affects the architecture or API
- Ensure `terraform plan` runs cleanly before submitting

## Testing Locally

### Frontend

Open `frontend/index.html` in a browser. For API integration, you'll need a deployed backend or a local mock.

### Backend

The Lambda handler can be tested by invoking it locally with a test event:

```bash
cd backend
node -e "
const { handler } = require('./index.js');
handler({
  httpMethod: 'GET',
  path: '/sorteos',
  headers: {}
}).then(console.log);
"
```

> Note: Requires `SORTEOS_TABLE`, `PARTICIPANTES_TABLE`, and `ADMIN_KEY` environment variables.

### Terraform

```bash
cd terraform
terraform fmt -check    # Check formatting
terraform validate      # Validate configuration
terraform plan          # Preview changes
```

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bugs
- For security vulnerabilities, please email the maintainers directly

## Code of Conduct

Be respectful, inclusive, and constructive. We follow the [AWS Community Code of Conduct](https://aws.amazon.com/codeofconduct/).
