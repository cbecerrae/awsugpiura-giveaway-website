data "aws_caller_identity" "current" {}

locals {
  lambda_name    = "${var.project_name}-api"
  api_name       = "${var.project_name}-rest-api"
  api_stage_name = "prod"

  frontend_bucket_name = "${var.project_name}-${data.aws_caller_identity.current.account_id}-${random_id.bucket_suffix.hex}"

  frontend_files = fileset("${path.module}/../frontend", "**")

  mime_types = {
    html = "text/html"
    css  = "text/css"
    js   = "application/javascript"
    json = "application/json"
    png  = "image/png"
    jpg  = "image/jpeg"
    jpeg = "image/jpeg"
    svg  = "image/svg+xml"
    ico  = "image/x-icon"
    txt  = "text/plain"
    ttf  = "font/ttf"
    map  = "application/json"
  }

  frontend_content_types = {
    for file in local.frontend_files :
    file => lookup(local.mime_types, lower(element(split(".", file), length(split(".", file)) - 1)), "application/octet-stream")
  }

  frontend_route_aliases = toset([
    "sorteo",
    "sorteo/",
    "sorteo/registrar",
    "sorteo/sortear",
    "sorteo/admin"
  ])

  api_invoke_url = "https://${aws_api_gateway_rest_api.raffle.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.prod.stage_name}"
}

resource "random_id" "bucket_suffix" {
  byte_length = 3
}

# ─── DynamoDB Tables ─────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "sorteos" {
  name         = var.sorteos_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sorteoId"

  attribute {
    name = "sorteoId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "participantes" {
  name         = var.participantes_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sorteoId"
  range_key    = "dni"

  attribute {
    name = "sorteoId"
    type = "S"
  }

  attribute {
    name = "dni"
    type = "S"
  }
}

# ─── Lambda IAM ──────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_role" {
  name               = "${var.project_name}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_permissions" {
  statement {
    sid = "DynamoDBAccess"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem"
    ]
    resources = [
      aws_dynamodb_table.sorteos.arn,
      aws_dynamodb_table.participantes.arn,
    ]
  }

  statement {
    sid = "CloudWatchLogs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "lambda_inline" {
  name   = "${var.project_name}-lambda-policy"
  role   = aws_iam_role.lambda_role.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

# ─── Lambda Function ─────────────────────────────────────────────────────────────

resource "null_resource" "npm_install" {
  triggers = {
    package_hash = filemd5("${path.module}/../backend/package.json")
  }
  provisioner "local-exec" {
    command     = "npm install --omit=dev"
    working_dir = "${path.module}/../backend"
  }
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
  output_path = "${path.module}/build/lambda.zip"
  depends_on  = [null_resource.npm_install]
}

resource "aws_lambda_function" "raffle_api" {
  function_name    = local.lambda_name
  role             = aws_iam_role.lambda_role.arn
  runtime          = var.lambda_runtime
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      SORTEOS_TABLE       = aws_dynamodb_table.sorteos.name
      PARTICIPANTES_TABLE = aws_dynamodb_table.participantes.name
      ADMIN_KEY           = var.admin_key
    }
  }
}

# ─── API Gateway ─────────────────────────────────────────────────────────────────

resource "aws_api_gateway_rest_api" "raffle" {
  name        = local.api_name
  description = "Multi-Raffle REST API"
}

resource "aws_api_gateway_resource" "sorteos" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  parent_id   = aws_api_gateway_rest_api.raffle.root_resource_id
  path_part   = "sorteos"
}

resource "aws_api_gateway_resource" "sorteo_id" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  parent_id   = aws_api_gateway_resource.sorteos.id
  path_part   = "{sorteoId}"
}

resource "aws_api_gateway_resource" "participantes" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  parent_id   = aws_api_gateway_resource.sorteo_id.id
  path_part   = "participantes"
}

resource "aws_api_gateway_resource" "close" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  parent_id   = aws_api_gateway_resource.sorteo_id.id
  path_part   = "close"
}

resource "aws_api_gateway_resource" "reopen" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  parent_id   = aws_api_gateway_resource.sorteo_id.id
  path_part   = "reopen"
}

# ─── Methods: /sorteos ───────────────────────────────────────────────────────────

resource "aws_api_gateway_method" "sorteos_get" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteos.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteos_get" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.sorteos.id
  http_method             = aws_api_gateway_method.sorteos_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "sorteos_post" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteos.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteos_post" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.sorteos.id
  http_method             = aws_api_gateway_method.sorteos_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "sorteos_options" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteos.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteos_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteos.id
  http_method = aws_api_gateway_method.sorteos_options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "sorteos_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteos.id
  http_method = aws_api_gateway_method.sorteos_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "sorteos_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteos.id
  http_method = aws_api_gateway_method.sorteos_options.http_method
  status_code = aws_api_gateway_method_response.sorteos_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.sorteos_options]
}

# ─── Methods: /sorteos/{sorteoId} ────────────────────────────────────────────────

resource "aws_api_gateway_method" "sorteo_id_get" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteo_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteo_id_get" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.sorteo_id.id
  http_method             = aws_api_gateway_method.sorteo_id_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "sorteo_id_delete" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteo_id.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteo_id_delete" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.sorteo_id.id
  http_method             = aws_api_gateway_method.sorteo_id_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "sorteo_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.sorteo_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sorteo_id_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteo_id.id
  http_method = aws_api_gateway_method.sorteo_id_options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "sorteo_id_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteo_id.id
  http_method = aws_api_gateway_method.sorteo_id_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "sorteo_id_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.sorteo_id.id
  http_method = aws_api_gateway_method.sorteo_id_options.http_method
  status_code = aws_api_gateway_method_response.sorteo_id_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.sorteo_id_options]
}

# ─── Methods: /sorteos/{sorteoId}/participantes ──────────────────────────────────

resource "aws_api_gateway_method" "participantes_get" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.participantes.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "participantes_get" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.participantes.id
  http_method             = aws_api_gateway_method.participantes_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "participantes_post" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.participantes.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "participantes_post" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.participantes.id
  http_method             = aws_api_gateway_method.participantes_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "participantes_delete" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.participantes.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "participantes_delete" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.participantes.id
  http_method             = aws_api_gateway_method.participantes_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "participantes_options" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.participantes.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "participantes_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.participantes.id
  http_method = aws_api_gateway_method.participantes_options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "participantes_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.participantes.id
  http_method = aws_api_gateway_method.participantes_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "participantes_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.participantes.id
  http_method = aws_api_gateway_method.participantes_options.http_method
  status_code = aws_api_gateway_method_response.participantes_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.participantes_options]
}

# ─── Methods: /sorteos/{sorteoId}/close ──────────────────────────────────────────

resource "aws_api_gateway_method" "close_patch" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.close.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "close_patch" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.close.id
  http_method             = aws_api_gateway_method.close_patch.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "close_options" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.close.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "close_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.close.id
  http_method = aws_api_gateway_method.close_options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "close_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.close.id
  http_method = aws_api_gateway_method.close_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "close_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.close.id
  http_method = aws_api_gateway_method.close_options.http_method
  status_code = aws_api_gateway_method_response.close_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.close_options]
}

# ─── Methods: /sorteos/{sorteoId}/reopen ─────────────────────────────────────────

resource "aws_api_gateway_method" "reopen_patch" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.reopen.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reopen_patch" {
  rest_api_id             = aws_api_gateway_rest_api.raffle.id
  resource_id             = aws_api_gateway_resource.reopen.id
  http_method             = aws_api_gateway_method.reopen_patch.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.raffle_api.invoke_arn
}

resource "aws_api_gateway_method" "reopen_options" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  resource_id   = aws_api_gateway_resource.reopen.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reopen_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.reopen.id
  http_method = aws_api_gateway_method.reopen_options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "reopen_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.reopen.id
  http_method = aws_api_gateway_method.reopen_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "reopen_options" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id
  resource_id = aws_api_gateway_resource.reopen.id
  http_method = aws_api_gateway_method.reopen_options.http_method
  status_code = aws_api_gateway_method_response.reopen_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.reopen_options]
}

# ─── Gateway Responses & Deployment ──────────────────────────────────────────────

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  response_type = "DEFAULT_4XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  response_type = "DEFAULT_5XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Admin-Key'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
  }
}

resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.raffle_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.raffle.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "raffle" {
  rest_api_id = aws_api_gateway_rest_api.raffle.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.sorteos.id,
      aws_api_gateway_resource.sorteo_id.id,
      aws_api_gateway_resource.participantes.id,
      aws_api_gateway_resource.close.id,
      aws_api_gateway_resource.reopen.id,
      aws_api_gateway_method.sorteos_get.id,
      aws_api_gateway_method.sorteos_post.id,
      aws_api_gateway_method.sorteo_id_get.id,
      aws_api_gateway_method.sorteo_id_delete.id,
      aws_api_gateway_method.participantes_get.id,
      aws_api_gateway_method.participantes_post.id,
      aws_api_gateway_method.participantes_delete.id,
      aws_api_gateway_method.close_patch.id,
      aws_api_gateway_method.reopen_patch.id,
    ]))
  }

  depends_on = [
    aws_lambda_permission.allow_apigw,
    aws_api_gateway_integration.sorteos_get,
    aws_api_gateway_integration.sorteos_post,
    aws_api_gateway_integration.sorteo_id_get,
    aws_api_gateway_integration.sorteo_id_delete,
    aws_api_gateway_integration.participantes_get,
    aws_api_gateway_integration.participantes_post,
    aws_api_gateway_integration.participantes_delete,
    aws_api_gateway_integration.close_patch,
    aws_api_gateway_integration.reopen_patch,
    aws_api_gateway_gateway_response.default_4xx,
    aws_api_gateway_gateway_response.default_5xx,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.raffle.id
  deployment_id = aws_api_gateway_deployment.raffle.id
  stage_name    = local.api_stage_name
}

# ─── S3 Frontend Bucket ──────────────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket        = local.frontend_bucket_name
  force_destroy = var.force_destroy_bucket
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket_read.json
}

data "aws_iam_policy_document" "frontend_bucket_read" {
  statement {
    sid = "AllowCloudFrontInCurrentAccountReadOnly"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
    condition {
      test     = "StringLike"
      variable = "AWS:SourceArn"
      values   = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"]
    }
  }
}

# ─── S3 Upload Frontend Files ────────────────────────────────────────────────────

resource "aws_s3_object" "frontend_assets" {
  for_each     = { for file in local.frontend_files : file => file }
  bucket       = aws_s3_bucket.frontend.id
  key          = each.value
  source       = "${path.module}/../frontend/${each.value}"
  etag         = filemd5("${path.module}/../frontend/${each.value}")
  content_type = local.frontend_content_types[each.value]
  depends_on   = [aws_s3_bucket_policy.frontend]
}

resource "aws_s3_object" "frontend_assets_sorteo" {
  for_each     = { for file in local.frontend_files : file => file }
  bucket       = aws_s3_bucket.frontend.id
  key          = "sorteo/${each.value}"
  source       = "${path.module}/../frontend/${each.value}"
  etag         = filemd5("${path.module}/../frontend/${each.value}")
  content_type = local.frontend_content_types[each.value]
  depends_on   = [aws_s3_bucket_policy.frontend]
}

resource "aws_s3_object" "frontend_config" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "config.json"
  content      = jsonencode({ apiBaseUrl = local.api_invoke_url })
  content_type = "application/json"
  depends_on   = [aws_api_gateway_stage.prod, aws_s3_bucket_policy.frontend]
}

resource "aws_s3_object" "frontend_config_sorteo" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "sorteo/config.json"
  content      = jsonencode({ apiBaseUrl = local.api_invoke_url })
  content_type = "application/json"
  depends_on   = [aws_api_gateway_stage.prod, aws_s3_bucket_policy.frontend]
}

resource "aws_s3_object" "frontend_route_aliases" {
  for_each     = local.frontend_route_aliases
  bucket       = aws_s3_bucket.frontend.id
  key          = each.value
  source       = "${path.module}/../frontend/index.html"
  etag         = filemd5("${path.module}/../frontend/index.html")
  content_type = "text/html"
  depends_on   = [aws_s3_bucket_policy.frontend]
}
