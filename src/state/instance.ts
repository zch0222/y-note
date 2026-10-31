import { createGateway } from '../platform/index.js'
import { AppStore } from './store.js'

export const store = new AppStore(createGateway())
