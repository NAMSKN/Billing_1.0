import type Database from 'better-sqlite3';
import type { Customer } from '@shared/domain/models';
import type { CustomerRepository } from '@shared/domain/repositories';
import { boolToInt, intToBool, toCanonicalUuid } from './mappers';

interface CustomerRow {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  bill_line: string;
  bill_state_name: string;
  bill_state_code: string;
  bill_godown: string;
  ship_line: string;
  ship_state_name: string;
  ship_state_code: string;
  ship_godown: string;
  is_active: number;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: toCanonicalUuid(row.id),
    name: row.name,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
    bill_to: {
      line: row.bill_line,
      state_name: row.bill_state_name,
      state_code: row.bill_state_code,
      godown: row.bill_godown,
    },
    ship_to: {
      line: row.ship_line,
      state_name: row.ship_state_name,
      state_code: row.ship_state_code,
      godown: row.ship_godown,
    },
    is_active: intToBool(row.is_active),
  };
}

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Database.Database) {}

  list(includeInactive = false): Customer[] {
    const sql = includeInactive
      ? 'SELECT * FROM customers ORDER BY name COLLATE NOCASE'
      : 'SELECT * FROM customers WHERE is_active = 1 ORDER BY name COLLATE NOCASE';
    const rows = this.db.prepare(sql).all() as CustomerRow[];
    return rows.map(rowToCustomer);
  }

  get(id: string): Customer | null {
    const row = this.db
      .prepare('SELECT * FROM customers WHERE id = ?')
      .get(toCanonicalUuid(id)) as CustomerRow | undefined;
    return row ? rowToCustomer(row) : null;
  }

  save(customer: Customer): void {
    this.db
      .prepare(
        `INSERT INTO customers (
           id, name, gstin, phone, email,
           bill_line, bill_state_name, bill_state_code, bill_godown,
           ship_line, ship_state_name, ship_state_code, ship_godown, is_active
         ) VALUES (
           @id, @name, @gstin, @phone, @email,
           @bill_line, @bill_state_name, @bill_state_code, @bill_godown,
           @ship_line, @ship_state_name, @ship_state_code, @ship_godown, @is_active
         )
         ON CONFLICT(id) DO UPDATE SET
           name=@name, gstin=@gstin, phone=@phone, email=@email,
           bill_line=@bill_line, bill_state_name=@bill_state_name,
           bill_state_code=@bill_state_code, bill_godown=@bill_godown,
           ship_line=@ship_line, ship_state_name=@ship_state_name,
           ship_state_code=@ship_state_code, ship_godown=@ship_godown,
           is_active=@is_active`,
      )
      .run({
        id: toCanonicalUuid(customer.id),
        name: customer.name,
        gstin: customer.gstin,
        phone: customer.phone,
        email: customer.email,
        bill_line: customer.bill_to.line,
        bill_state_name: customer.bill_to.state_name,
        bill_state_code: customer.bill_to.state_code,
        bill_godown: customer.bill_to.godown,
        ship_line: customer.ship_to.line,
        ship_state_name: customer.ship_to.state_name,
        ship_state_code: customer.ship_to.state_code,
        ship_godown: customer.ship_to.godown,
        is_active: boolToInt(customer.is_active),
      });
  }

  archive(id: string): void {
    // Archival, not destructive delete (Req 43): keep the record for history.
    this.db.prepare('UPDATE customers SET is_active = 0 WHERE id = ?').run(toCanonicalUuid(id));
  }
}
