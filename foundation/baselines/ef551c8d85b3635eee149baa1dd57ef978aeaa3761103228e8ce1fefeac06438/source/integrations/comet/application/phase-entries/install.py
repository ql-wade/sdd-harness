#!/usr/bin/env python3
"""Install project-scoped Codex stage entries without modifying upstream Skills.

This is an installer, not a workflow controller. It does not start a Run,
call a model, change business state or claim that any gate is qualified.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tomllib

NAMES=('comet','comet-open','comet-design','comet-build','comet-verify','comet-archive')
SOURCE=Path(__file__).resolve().parent
BEGIN='# BEGIN sdd-comet-project-stage-routing'
END='# END sdd-comet-project-stage-routing'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')


def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'expected regular file: {path}')
    return path.read_bytes()


def plan(project, config):
    if not project.is_absolute() or not config.is_absolute() or config.name!='config.toml' or config.parent.name!='.codex':
        raise ValueError('an absolute project and Codex config.toml path are required')
    project=project.resolve(strict=True)
    skills=project/'.agents'/'skills'
    if (project/'.agents').is_symlink() or skills.is_symlink() or not skills.is_dir():raise ValueError('project skills directory unavailable')
    host_dir=project/'.codex';target_skills=host_dir/'skills'
    for directory in (host_dir,target_skills):
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError(f'unsafe Codex skill directory: {directory}')
    raw=regular(config)
    data=tomllib.loads(raw.decode('utf-8'))
    settings=data.get('skills',{}).get('config',[])
    if not isinstance(settings,list):raise ValueError('invalid existing Codex skills configuration')
    entries=[]
    for name in NAMES:
        original=skills/name/'SKILL.md';source=SOURCE/name/'SKILL.md';target=target_skills/(name+'-managed')
        legacy=skills/(name+'-managed')
        if legacy.exists() or legacy.is_symlink():raise ValueError(f'legacy stage entry requires safe migration: {name}')
        if original.parent.is_symlink() or source.parent.is_symlink():raise ValueError(f'unsafe stage directory: {name}')
        original_bytes=regular(original);source_bytes=regular(source)
        if not source_bytes.startswith(b'---\n') or f'\nname: {name}\n'.encode() not in source_bytes[:512]:
            raise ValueError(f'invalid stage source: {name}')
        if target.is_symlink():raise ValueError(f'unsafe target: {name}')
        if target.exists():
            if not target.is_dir() or sorted(p.name for p in target.iterdir())!=['SKILL.md'] or regular(target/'SKILL.md')!=source_bytes:
                raise ValueError(f'existing stage target differs: {name}')
            target_state='unchanged'
        else:target_state='create'
        selected=[x for x in settings if isinstance(x,dict) and x.get('path')==str(original)]
        aliases=[x for x in settings if isinstance(x,dict) and isinstance(x.get('path'),str)
                 and os.path.isabs(x['path']) and x['path']!=str(original) and os.path.realpath(x['path'])==str(original)]
        if aliases:raise ValueError(f'ambiguous existing path alias: {name}')
        if len(selected)>1 or any(x.get('enabled') is not False for x in selected):
            raise ValueError(f'existing enablement conflicts: {name}')
        entries.append({'name':name,'original':str(original),'originalSha256':digest(original_bytes),
                        'target':str(target),'sourceSha256':digest(source_bytes),'targetOperation':target_state,
                        'disableOperation':'unchanged' if selected else 'append'})
    body={'schema':'sdd.comet.codex-stage-install.v1','project':str(project),'config':str(config),
          'configSha256':digest(raw),'entries':entries,
          'changesNeeded':any(x['targetOperation']=='create' or x['disableOperation']=='append' for x in entries)}
    body['confirmationHash']=digest(canonical(body))
    return body


def apply(project,config,confirmation):
    proposed=plan(project,config)
    if proposed['confirmationHash']!=confirmation:raise ValueError('preview is stale; no writes performed')
    created=[];created_parents=[];suffix=b''
    config_fd=os.open(config,os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW)
    with os.fdopen(config_fd,'r+b',buffering=0) as stream:
        fcntl.flock(stream.fileno(),fcntl.LOCK_EX)
        stream.seek(0)
        before=stream.read()
        descriptor=os.fstat(stream.fileno());named=os.stat(config)
        if digest(before)!=proposed['configSha256'] or (descriptor.st_dev,descriptor.st_ino)!=(named.st_dev,named.st_ino):
            raise ValueError('Codex configuration changed after preview')
        try:
            for directory in (Path(proposed['project'])/'.codex', Path(proposed['project'])/'.codex'/'skills'):
                if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
                    raise ValueError(f'unsafe Codex skill directory: {directory}')
                if not directory.exists():
                    directory.mkdir(mode=0o755);created_parents.append(directory)
            for row in proposed['entries']:
                if digest(regular(SOURCE/row['name']/'SKILL.md'))!=row['sourceSha256'] or digest(regular(Path(row['original'])))!=row['originalSha256']:
                    raise ValueError('stage inputs changed after preview')
            for row in proposed['entries']:
                if row['targetOperation']!='create':continue
                target=Path(row['target']);source=SOURCE/row['name']/'SKILL.md';data=regular(source)
                target.mkdir(mode=0o755);created.append((target,data))
                fd=os.open(target/'SKILL.md',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
                with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
            additions=[row for row in proposed['entries'] if row['disableOperation']=='append']
            if additions:
                lines=['',BEGIN]
                for row in additions:
                    lines.extend(['[[skills.config]]','path = '+json.dumps(row['original'],ensure_ascii=False),'enabled = false',''])
                lines.append(END)
                suffix=('\n'.join(lines)+'\n').encode('utf-8')
                stream.seek(0,os.SEEK_END);stream.write(suffix);stream.flush();os.fsync(stream.fileno())
                stream.seek(0);after=stream.read()
                if after!=before+suffix:raise ValueError('Codex configuration changed during update')
                tomllib.loads(after.decode('utf-8'))
        except Exception:
            if suffix:
                stream.seek(0);current=stream.read()
                if current==before+suffix:stream.seek(len(before));stream.truncate();stream.flush();os.fsync(stream.fileno())
            for target,data in reversed(created):
                file=target/'SKILL.md'
                if file.is_file() and not file.is_symlink() and file.read_bytes()==data and sorted(p.name for p in target.iterdir())==['SKILL.md']:
                    file.unlink();target.rmdir()
                elif not any(target.iterdir()):target.rmdir()
            for directory in reversed(created_parents):
                if directory.is_dir() and not directory.is_symlink() and not any(directory.iterdir()):directory.rmdir()
            raise
    return {'schema':proposed['schema'],'applied':True,'project':proposed['project'],
            'created':[row['name'] for row in proposed['entries'] if row['targetOperation']=='create'],
            'disabledProjectOriginals':[row['original'] for row in proposed['entries'] if row['disableOperation']=='append']}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--project',required=True,type=Path)
    parser.add_argument('--codex-config',required=True,type=Path)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--preview',action='store_true')
    modes.add_argument('--apply',metavar='CONFIRMATION_HASH')
    args=parser.parse_args()
    try:
        result=plan(args.project,args.codex_config) if args.preview else apply(args.project,args.codex_config,args.apply)
        print(json.dumps(result,ensure_ascii=False,sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False),file=sys.stderr)
        return 2

if __name__=='__main__':
    sys.exit(main())
