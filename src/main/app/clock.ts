/**
 * Injectable clock and id generator so services stay deterministic in tests
 * (DECISIONS D-023: inject an id generator; do not monkeypatch uuid globally).
 */
import { v4 as uuidv4 } from 'uuid';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type IdGenerator = () => string;

export const uuid4Generator: IdGenerator = () => uuidv4();
