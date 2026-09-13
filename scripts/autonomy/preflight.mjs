import { runProcess } from './runner.mjs';

const result = await runProcess('junie', ['--skip-update-check', '--output-format=json', '--task', 'Read-only authentication and process transport preflight. Do not use tools, edit files or start processes. Reply with OCRDOCS_AGENT_PREFLIGHT_OK only.'], { cwd: process.cwd(), timeoutMs: 60000 });
process.stdout.write(result.output);
process.exitCode = result.code === 0 && result.output.includes('OCRDOCS_AGENT_PREFLIGHT_OK') ? 0 : 1;