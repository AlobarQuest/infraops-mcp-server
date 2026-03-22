import axios from 'axios';

const params = {
  ApiUser: 'alobar',
  ApiKey: 'e2a987d4f2fb4e2692453f556ab48308',
  UserName: 'alobar',
  ClientIp: '178.156.247.239',
  Command: 'namecheap.domains.getList',
  PageSize: 100,
};

try {
  const resp = await axios.get('https://api.sandbox.namecheap.com/xml.response', { params });
  console.log('Status:', resp.status);
  console.log('Content-Type:', resp.headers['content-type']);
  console.log('---RAW BODY---');
  console.log(typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2));
} catch (err) {
  console.error('HTTP Error:', err.message);
  if (err.response) {
    console.error('Status:', err.response.status);
    console.error('Body:', err.response.data);
  }
}
