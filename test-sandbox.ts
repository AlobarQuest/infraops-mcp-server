import { namecheapCommand, getNamecheapEnvironment } from './src/services/namecheap-client.js';

async function main() {
  console.log('Environment:', getNamecheapEnvironment());
  console.log('---');

  // Test 1: List domains
  console.log('\n=== domains.getList ===');
  try {
    const result = await namecheapCommand('namecheap.domains.getList', { PageSize: 100 });
    console.log(JSON.stringify(result.CommandResponse, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }

  // Test 2: Check domain availability
  console.log('\n=== domains.check ===');
  try {
    const result = await namecheapCommand('namecheap.domains.check', { DomainList: 'testdomain12345.com,example.com' });
    console.log(JSON.stringify(result.CommandResponse, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }
}

main();
