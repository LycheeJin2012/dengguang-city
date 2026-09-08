import json, sqlite3, sys
conn=sqlite3.connect(sys.argv[1], isolation_level=None)
conn.row_factory=sqlite3.Row
conn.execute('PRAGMA foreign_keys=ON')
def query(q):
 cur=conn.execute(q['sql'],q.get('params',[]))
 rows=[dict(r) for r in cur.fetchall()] if cur.description else []
 return {'results':rows,'meta':{'last_row_id':cur.lastrowid,'changes':max(cur.rowcount,0)},'success':True}
for line in sys.stdin:
 try:
  req=json.loads(line)
  if 'batch' in req:
   conn.execute('BEGIN IMMEDIATE')
   try: result=[query(q) for q in req['batch']];conn.execute('COMMIT')
   except:conn.execute('ROLLBACK');raise
  else:result=query(req)
  print(json.dumps({'id':req['id'],'result':result},ensure_ascii=False),flush=True)
 except Exception as e:
  print(json.dumps({'id':req.get('id'),'error':str(e)}),flush=True)
