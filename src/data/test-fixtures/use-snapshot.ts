import fixtureJson from './opportunity-data.fixture.json'
import type { VaultSnapshot } from '../../types/records'
import { installTestSnapshot } from '../selectors'

installTestSnapshot(fixtureJson as unknown as VaultSnapshot)
