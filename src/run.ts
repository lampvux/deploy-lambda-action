import * as core from '@actions/core'
import {
  CreateAliasCommand,
  CreateAliasCommandInput,
  CreateAliasCommandOutput,
  LambdaClient,
  ResourceConflictException,
  UpdateAliasCommand,
  UpdateAliasCommandInput,
  UpdateAliasCommandOutput,
  UpdateFunctionCodeCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  CreateFunctionCommandOutput,
  UpdateFunctionCodeCommandOutput,
  CreateFunctionCommandInput,
  ResourceNotFoundException,
} from '@aws-sdk/client-lambda'
import {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  GetRoleCommand,
  NoSuchEntityException,
} from '@aws-sdk/client-iam'

import { readFile } from 'fs/promises'

type Inputs = {
  functionName: string
  imageURI?: string
  zipPath?: string
  aliasName: string
  aliasDescription: string
  timeOut?: number
  memorySize?: number
  role?: string
  environmentVariables?: string
}

type Outputs = {
  functionVersion: string
  functionVersionARN: string
  functionAliasARN?: string
}

export const run = async (inputs: Inputs): Promise<Outputs> => {
  const client = new LambdaClient({})
  const functionExisted = await checkIfFunctionExists(client, inputs)

  const updatedFunction = functionExisted
    ? await updateFunctionCode(client, inputs)
    : await createFunctionCode(client, inputs)

  const functionVersion = updatedFunction.Version
  const functionVersionARN = updatedFunction.FunctionArn
  if (functionVersion === undefined) {
    throw new Error(`internal error: Version is undefined Version`)
  }
  if (functionVersionARN === undefined) {
    throw new Error(`internal error: FunctionArn is undefined`)
  }
  core.info(`Published version ${functionVersion}`)
  core.info(`Available version ${functionVersionARN}`)

  if (!inputs.aliasName) {
    return { functionVersion, functionVersionARN }
  }
  const alias = await createOrUpdateAlias(client, {
    FunctionName: inputs.functionName,
    FunctionVersion: functionVersion,
    Name: inputs.aliasName,
    Description: inputs.aliasDescription,
  })
  const functionAliasARN = alias.AliasArn
  if (functionAliasARN === undefined) {
    throw new Error(`internal error: AliasArn is undefined`)
  }
  core.info(`Available alias ${functionAliasARN}`)
  return { functionVersion, functionVersionARN, functionAliasARN }
}

async function checkIfFunctionExists(client: LambdaClient, inputs: Inputs) {
  try {
    const params = { FunctionName: inputs.functionName }
    await client.send(new GetFunctionCommand(params))
    core.info(`Function ${inputs.functionName} exist`)
    return true
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      console.log(`Function ${inputs.functionName} does not exist`)
      return false
    }
    throw error
  }
}
const isRoleNameExists = async (roleName: string) => {
  const iam = new IAMClient({ region: 'us-east-1' }) // Update the region as per your requirement

  try {
    const role = await iam.send(new GetRoleCommand({ RoleName: roleName }))
    const roleArn = role?.Role?.Arn
    return roleArn
  } catch (err) {
    if (err instanceof NoSuchEntityException) {
      return false // Role name doesn't exist
    }
    throw err // Throw the error for other issues
  }
}
const createIamRoleLambdaBasic = async (inputs: Inputs) => {
  // Create a new IAM instance
  const iam = new IAMClient({})

  // Define the role name
  const roleName = `${inputs.functionName}`

  // Define the trust policy document
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'lambda.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  }

  // Define the policy document
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: 'arn:aws:logs:*:*:*',
      },
    ],
  }
  try {
    const data = await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
      })
    )
    await iam.send(
      new PutRolePolicyCommand({
        PolicyDocument: JSON.stringify(policy),
        PolicyName: 'LambdaBasicExecution',
        RoleName: roleName,
      })
    )
    return data?.Role?.Arn
  } catch (error) {
    console.log('Error creating IAM role:', error)
  }
}

const createFunctionCode = async (client: LambdaClient, inputs: Inputs): Promise<CreateFunctionCommandOutput> => {
  const params: CreateFunctionCommandInput = {
    FunctionName: inputs.functionName,
    Code: {
      ImageUri: inputs.imageURI, // set ecr image uri
    },
    PackageType: 'Image',
    Timeout: inputs.timeOut, // Set the timeout
    MemorySize: inputs.memorySize, // Set the memory size
    Role: undefined, // role
    Environment: {
      // Add environment variables
      Variables: JSON.parse(inputs.environmentVariables ?? '{}') as Record<string, string>,
    },
    // add more attribute here
  }

  try {
    if (inputs.role) {
      params.Role = inputs.role
    } else {
      const role = await isRoleNameExists(inputs.functionName)
      params.Role = role ? role : await createIamRoleLambdaBasic(inputs)
    }
    return await client.send(new CreateFunctionCommand(params))
  } catch (error) {
    core.info(`Can not create function: ${JSON.stringify(error)}`)
    throw error
  }
}

const updateFunctionCode = async (client: LambdaClient, inputs: Inputs): Promise<UpdateFunctionCodeCommandOutput> => {
  if (inputs.zipPath) {
    core.info(`Updating function ${inputs.functionName} to archive ${inputs.zipPath}`)
    const zipFile = await readFile(inputs.zipPath)
    return await client.send(
      new UpdateFunctionCodeCommand({
        FunctionName: inputs.functionName,
        ZipFile: zipFile,
        Publish: true,
      })
    )
  }
  if (inputs.imageURI) {
    core.info(`Updating function ${inputs.functionName} to image ${inputs.imageURI}`)
    return await client.send(
      new UpdateFunctionCodeCommand({
        FunctionName: inputs.functionName,
        ImageUri: inputs.imageURI,
        Publish: true,
      })
    )
  }
  throw new Error(`either image-uri or zip-path must be set`)
}

const createOrUpdateAlias = async (
  client: LambdaClient,
  input: CreateAliasCommandInput & UpdateAliasCommandInput
): Promise<CreateAliasCommandOutput | UpdateAliasCommandOutput> => {
  core.info(`Creating alias ${String(input.Name)}`)
  try {
    return await client.send(new CreateAliasCommand(input))
  } catch (error) {
    if (error instanceof ResourceConflictException) {
      core.info(`Alias already exists: ${error.message}`)
      core.info(`Updating alias ${String(input.Name)}`)
      return await client.send(new UpdateAliasCommand(input))
    }
    throw error
  }
}
