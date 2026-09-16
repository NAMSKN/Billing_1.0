import type { ProductGroup } from '@shared/domain/product';
import type { ProductGroupRepository } from '../db/productGroupRepository';
import type { IdGenerator } from './clock';
import { uuid4Generator } from './clock';

export class ProductGroupServiceError extends Error {}

/** Product group service (faithful port). Names unique among active groups. */
export class ProductGroupService {
  constructor(
    private readonly repo: ProductGroupRepository,
    private readonly ids: IdGenerator = uuid4Generator,
  ) {}

  createGroup(name: string): ProductGroup {
    const clean = name.trim();
    if (!clean) throw new ProductGroupServiceError('Group name is required.');
    if (this.repo.getByName(clean)) {
      throw new ProductGroupServiceError(`A group named '${clean}' already exists.`);
    }
    const group: ProductGroup = { id: this.ids(), name: clean, is_active: true };
    this.repo.save(group);
    return group;
  }

  /** Create if missing, else return the existing active group (import helper). */
  ensureGroup(name: string): ProductGroup {
    const existing = this.repo.getByName(name.trim());
    if (existing) return existing;
    return this.createGroup(name);
  }

  renameGroup(id: string, newName: string): ProductGroup {
    const clean = newName.trim();
    if (!clean) throw new ProductGroupServiceError('Group name is required.');
    const group = this.repo.get(id);
    if (!group) throw new ProductGroupServiceError('Group not found.');
    const clash = this.repo.getByName(clean);
    if (clash && clash.id !== id) {
      throw new ProductGroupServiceError(`A group named '${clean}' already exists.`);
    }
    const renamed = { ...group, name: clean };
    this.repo.save(renamed);
    return renamed;
  }

  archiveGroup(id: string): ProductGroup {
    const group = this.repo.get(id);
    if (!group) throw new ProductGroupServiceError('Group not found.');
    const archived = { ...group, is_active: false };
    this.repo.save(archived);
    return archived;
  }

  listGroups(includeArchived = false): ProductGroup[] {
    return this.repo.listAll(includeArchived);
  }

  getGroup(id: string): ProductGroup | null {
    return this.repo.get(id);
  }
}
