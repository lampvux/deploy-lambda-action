# deploy-lambda-action [![ts](https://github.com/lampvux/deploy-lambda-action/actions/workflows/ts.yaml/badge.svg)](https://github.com/lampvux/deploy-lambda-action/actions/workflows/ts.yaml)

This is an action to deploy a container image to an existing Lambda function.

## Getting Started

To [deploy a container image to a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-images.html):

```yaml
jobs:
  deploy:
    steps:
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/ROLE
      - uses: int128/create-ecr-repository-action@v1
        with:
          function-name: my-function
          image-uri: ACCOUNT.dkr.ecr.REGION.amazonaws.com/NAME:VERSION
```

To [deploy an archive to a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-zip.html):

```yaml
jobs:
  deploy:
    steps:
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/ROLE
      - uses: int128/create-ecr-repository-action@v1
        with:
          function-name: my-function
          zip-path: main.zip
```

This action publishes a new version of Lambda function.

### Lambda function alias

To deploy a container image to a Lambda function with an [alias](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html):

```yaml
jobs:
  deploy:
    steps:
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/ROLE
      - uses: int128/create-ecr-repository-action@v1
        with:
          function-name: my-function
          image-uri: ACCOUNT.dkr.ecr.REGION.amazonaws.com/NAME:VERSION
          alias-name: staging
```

This action creates an alias or updates it to the published version.
It is useful for the pull request preview environment such as `pr-12345`.

## Full examples

### Lambda function with container image

Here is an example to build and deploy a container image to Lambda function.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v3
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/ROLE

      # build
      - uses: aws-actions/amazon-ecr-login@v1
        id: ecr
      - uses: docker/metadata-action@v4
        id: metadata
        with:
          images: ${{ steps.ecr.outputs.registry }}/${{ github.repository }}
          flavor: latest=false
      - uses: docker/build-push-action@v3
        with:
          push: true
          tags: ${{ steps.metadata.outputs.tags }}
          labels: ${{ steps.metadata.outputs.labels }}

      # deploy
      - uses: int128/deploy-lambda-action@v1
        with:
          function-name: my-function
          image-uri: ${{ steps.metadata.outputs.tags }}
          alias-name: ${{ steps.metadata.outputs.version }}
```

This example depends on the naming convention of [docker/metadata-action](https://github.com/docker/metadata-action).

When a pull request is opened or updated,

- It builds a container image and pushes it into ECR.
- It deploys it to an alias of pull request number such as `pr-12345`.

When a branch is pushed,

- It builds a container image and pushes it into ECR.
- It deploys it to an alias of branch name such as `main` or `production`.

### Lambda function with archive

Here is an example to build Go application and deploy it to Lambda function.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v3

      # build
      - uses: actions/setup-go@v4
        with:
          go-version: 1.20
      - run: go build -o main
      - run: zip main.zip main

      # deploy
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/ROLE
      - uses: int128/deploy-lambda-action@v1
        with:
          function-name: my-function
          zip-path: main.zip
          alias-name: ${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || github.ref_name }}
```

When a pull request is opened or updated,

- It deploys it to an alias of pull request number such as `pr-12345`.

When a branch is pushed,

- It deploys it to an alias of branch name such as `main` or `production`.

## Prepare environment

### IAM

You need to attach the permission to the IAM Role of GitHub Actions.

```hcl
# terraform
resource "aws_iam_role_policy" "github_actions_deploy_lambda" {
  role   = aws_iam_role.github_actions_deploy_lambda.id
  name   = "update-lambda"
  policy = data.aws_iam_policy_document.github_actions_deploy_lambda.json
}

data "aws_iam_policy_document" "github_actions_deploy_lambda" {
  statement {
    effect = "Allow"
    actions = [
      "lambda:GetFunction",
      "lambda:CreateFunction",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:CreateAlias",
      "lambda:UpdateAlias",
      "iam:GetRole",
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:PassRole"

    ]
    resources = [
      "arn:aws:lambda:REGION:ACCOUNT:function:FUNCTION",
      "arn:aws:iam::ACCOUNT:role/FUNCTION",
      "arn:aws:iam::ACCOUNT:policy/FUNCTION-LambdaBasicExecution"
    ]
  }
}
```

## Specification

### Inputs

| Name | Description
|------|------------
| `function-name` | Lambda function name
| `image-uri` | URI of container image, i.e., `ACCOUNT.dkr.ecr.REGION.amazonaws.com/NAME:VERSION` or `ACCOUNT.dkr.ecr.REGION.amazonaws.com/NAME@DIGEST`
| `zip-path` | Path to an archive
| `alias-name` | Alias name (optional)
| `alias-description` | Alias description (optional)
| `timeOut` | Lambda timeout (optional)
| `memorySize` | Lambda memory size (optional)
| `role` | Execution role (optional)
| `environmentVariables` | Execution environment variables (optional) (a JSON string containing environment variables and its values)

Either `image-uri` or `zip-path` must be set.

### Outputs

| Name | Description
|------|------------
| `function-version` | Published version
| `function-version-arn` | ARN of published version
