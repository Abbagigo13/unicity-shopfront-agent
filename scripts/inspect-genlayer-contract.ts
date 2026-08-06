import 'dotenv/config';
import { createClient } from 'genlayer-js';
import * as chains from 'genlayer-js/chains';

const CHAIN_NAME = process.env.GENLAYER_CHAIN || 'studionet';
const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS;

async function main() {
  if (!CONTRACT_ADDRESS) throw new Error('Set GENLAYER_CONTRACT_ADDRESS in .env first.');

  const chain = (chains as Record<string, unknown>)[CHAIN_NAME];
  if (!chain) throw new Error(`Unknown chain "${CHAIN_NAME}" — expected localnet, studionet, or testnetAsimov.`);

  const client = createClient({ chain: chain as never });

  const schema = await client.getContractSchema({ address: CONTRACT_ADDRESS });
  console.log(JSON.stringify(schema, null, 2));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods = (schema as any).methods ?? {};
  console.log('\n--- Quick reference ---');
  for (const [name, def] of Object.entries<any>(methods)) {
    console.log(`${def.readonly ? '[read] ' : '[write]'} ${name}(${(def.params ?? []).map((p: any) => p[0]).join(', ')}) -> ${def.ret}`);
  }
  console.log('\nUpdate GENLAYER_SUBMIT_METHOD / GENLAYER_RESULT_METHOD in .env with the real names above.');
}

main().catch((err) => {
  console.error('Schema fetch failed:', err);
  process.exit(1);
});
