#!/usr/bin/env python3
"""Materialize portable root/tool references only; never execute TestPack commands."""
import argparse,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--project-root',required=True);p.add_argument('--node',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(a.project_root).resolve();node=pathlib.Path(a.node).resolve()
if not root.is_dir() or not node.is_file():raise SystemExit('trusted root and explicit Node are required')
version=subprocess.run([str(node),'--version'],capture_output=True,text=True,check=True).stdout.strip()
if version!='v24.15.0':raise SystemExit('exact Node24.15.0 required')
source=pathlib.Path(__file__).with_name('test-pack.template.json');pack=json.loads(source.read_text())
def materialize(value):
 if isinstance(value,str):return str(root) if value=='<repo>' else str(node) if value=='<node24.15>' else value
 if isinstance(value,list):return [materialize(item) for item in value]
 if isinstance(value,dict):return {key:materialize(item) for key,item in value.items()}
 return value
out=pathlib.Path(a.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
with out.open('x') as stream:json.dump(materialize(pack),stream,ensure_ascii=False,indent=2);stream.write('\n')
print('TEST_PACK_MATERIALIZED_NO_COMMANDS_EXECUTED')
