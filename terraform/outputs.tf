output "api_invoke_url" {
  description = "Invoke URL of API Gateway prod stage."
  value       = local.api_invoke_url
}

output "frontend_bucket_name" {
  description = "S3 bucket storing frontend assets."
  value       = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  description = "ARN of the S3 frontend bucket."
  value       = aws_s3_bucket.frontend.arn
}

output "frontend_bucket_regional_domain_name" {
  description = "Regional domain name to use as CloudFront S3 origin."
  value       = aws_s3_bucket.frontend.bucket_regional_domain_name
}

output "sorteos_table_name" {
  description = "DynamoDB sorteos table."
  value       = aws_dynamodb_table.sorteos.name
}

output "participantes_table_name" {
  description = "DynamoDB participantes table."
  value       = aws_dynamodb_table.participantes.name
}
