import * as jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const secret = process.env.JWT_SECRET!;

const cashierToken = jwt.sign(
  {
    sub: 'test-cashier-id',
    email: 'cashier@test.com',
    role: 'cashier',
    tenant_id: 'test-tenant-id',
    session_id: 'test-session-id',
  },
  secret,
  { expiresIn: '1h' },
);

const ownerToken = jwt.sign(
  {
    sub: 'test-owner-id',
    email: 'owner@test.com',
    role: 'owner',
    tenant_id: 'test-tenant-id',
    session_id: 'test-session-id',
  },
  secret,
  { expiresIn: '1h' },
);

console.log('CASHIER TOKEN:');
console.log(cashierToken);
console.log('\nOWNER TOKEN:');
console.log(ownerToken);