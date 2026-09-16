import type { PartyGroup } from '@shared/domain/party';
import type { PartyGroupRepository } from '../db/partyGroupRepository';
import type { IdGenerator } from './clock';
import { uuid4Generator } from './clock';

export class PartyServiceError extends Error {}

/**
 * Party group service (faithful port). Groups are created/renamed/archived
 * (never hard-deleted, so party references stay intact). Names are unique among
 * active groups.
 */
export class PartyGroupService {
  constructor(
    private readonly repo: PartyGroupRepository,
    private readonly ids: IdGenerator = uuid4Generator,
  ) {}

  createGroup(name: string): PartyGroup {
    const clean = name.trim();
    if (!clean) throw new PartyServiceError('Group name is required.');
    if (this.repo.getByName(clean)) {
      throw new PartyServiceError(`A group named '${clean}' already exists.`);
    }
    const group: PartyGroup = { id: this.ids(), name: clean, is_active: true };
    this.repo.save(group);
    return group;
  }

  renameGroup(id: string, newName: string): PartyGroup {
    const clean = newName.trim();
    if (!clean) throw new PartyServiceError('Group name is required.');
    const group = this.repo.get(id);
    if (!group) throw new PartyServiceError('Group not found.');
    const clash = this.repo.getByName(clean);
    if (clash && clash.id !== id) {
      throw new PartyServiceError(`A group named '${clean}' already exists.`);
    }
    const renamed = { ...group, name: clean };
    this.repo.save(renamed);
    return renamed;
  }

  archiveGroup(id: string): PartyGroup {
    const group = this.repo.get(id);
    if (!group) throw new PartyServiceError('Group not found.');
    const archived = { ...group, is_active: false };
    this.repo.save(archived);
    return archived;
  }

  listGroups(includeArchived = false): PartyGroup[] {
    return this.repo.listAll(includeArchived);
  }

  getGroup(id: string): PartyGroup | null {
    return this.repo.get(id);
  }
}
