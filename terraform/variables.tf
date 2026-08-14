variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use."
  type        = string
  default     = "morrislab"
}

variable "project_name" {
  description = "Project name prefix for resources."
  type        = string
  default     = "awsugpiura-raffle"
}

variable "sorteos_table_name" {
  description = "DynamoDB table for sorteos (raffles)."
  type        = string
  default     = "awsugpiura-raffle-sorteos"
}

variable "participantes_table_name" {
  description = "DynamoDB table for participants."
  type        = string
  default     = "awsugpiura-raffle-participantes"
}

variable "lambda_runtime" {
  description = "Node.js runtime for Lambda."
  type        = string
  default     = "nodejs20.x"
}

variable "force_destroy_bucket" {
  description = "Allow Terraform to delete S3 bucket with objects on destroy."
  type        = bool
  default     = false
}

variable "admin_key" {
  description = "Admin key for protected operations. Set in terraform.tfvars (never commit this value)."
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Common tags for all resources."
  type        = map(string)
  default = {
    Project     = "awsugpiura-raffle"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}
