import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as leaderboard} from '../functions/api/leaderboard.js';
import {onRequestGet as raceTimes} from '../functions/api/race-times.js';

test('retired ranking endpoints return no ranking data and do not query player records',async()=>{
 const DB={prepare(){throw new Error('Retired rankings must not query player records');}};
 for(const [path,handler] of [['leaderboard?type=messages',leaderboard],['race-times?track_id=1',raceTimes]]){
  const response=await handler({request:new Request('https://local.test/api/'+path),env:{DB}});
  assert.equal(response.status,410);
  const data=await response.json();assert.equal(data.entries,undefined);assert.equal(data.leaderboard,undefined);
 }
});
