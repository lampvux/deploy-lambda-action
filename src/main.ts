import * as core from '@actions/core'
import { run } from './run'

const main = async (): Promise<void> => {
  const outputs = await run({
    functionName: core.getInput('function-name', { required: true }),
    imageURI: core.getInput('image-uri') || undefined,
    zipPath: core.getInput('zip-path') || undefined,
    aliasName: core.getInput('alias-name'),
    aliasDescription: core.getInput('alias-description'),
    timeOut: Number(core.getInput('time-out')) || undefined,
    memorySize: Number(core.getInput('memory-size')) || undefined,
    role: core.getInput('role') || undefined,
    environmentVariables: core.getInput('environmentVariables') || '{}',
  })
  core.setOutput('function-version', outputs.functionVersion)
  core.setOutput('function-version-arn', outputs.functionVersionARN)
  core.setOutput('function-alias-arn', outputs.functionAliasARN)
}

main().catch((e) => core.setFailed(e instanceof Error ? e : String(e)))
