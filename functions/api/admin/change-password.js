import {changePassword} from '../../_core/accounts.js';import {endpoint} from '../../_core/request.js';
export const onRequestPost=c=>endpoint(()=>changePassword(c,'admin'));
