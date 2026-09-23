#!/usr/bin/env python3
"""sqlite-archeologist.py -- Deep search across claude-mem SQLite database for observations, tool runs, and summaries."""
import os
import sys
import json
import sqlite3
import argparse

def get_db_path():
    return os.path.expanduser('~/.claude-mem/claude-mem.db')

def parse_args():
    parser = argparse.ArgumentParser(description="Query claude-mem SQLite database for historical laboratory facts.")
    parser.add_argument("--tokens", type=str, required=True, help="JSON array or comma-separated tokens")
    parser.add_argument("--project", type=str, default=None, help="Optional project directory filter")
    parser.add_argument("--limit", type=int, default=10, help="Max results per category")
    return parser.parse_args()

def safe_fts_term(t):
    # Quote if contains punctuation or special chars
    if any(c in t for c in '.-_:/\\'):
        return f'"{t}"'
    return t

def main():
    args = parse_args()
    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(json.dumps({"observations": [], "tool_uses": [], "session_summaries": []}))
        return

    # Parse tokens
    raw_tokens = args.tokens
    try:
        tokens = json.loads(raw_tokens)
    except Exception:
        tokens = [t.strip().lower() for t in raw_tokens.split(",") if t.strip()]

    tokens = [t.lower() for t in tokens if len(t) > 1]
    if not tokens:
        print(json.dumps({"observations": [], "tool_uses": [], "session_summaries": []}))
        return

    rare_tokens = {t for t in tokens if any(c.isdigit() for c in t) or len(t) >= 6 or any(c in t for c in '.-_')}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    out = {
        "observations": [],
        "tool_uses": [],
        "session_summaries": []
    }

    # 1. Search Observations
    try:
        # Search rare tokens via FTS first if possible
        search_terms = rare_tokens if rare_tokens else set(tokens[:5])
        fts_query = ' OR '.join(safe_fts_term(t) for t in search_terms)
        c.execute("SELECT rowid FROM observations_fts WHERE observations_fts MATCH ? LIMIT 200", (fts_query,))
        rowids = [r[0] for r in c.fetchall()]
        
        # Also include LIKE matches for numeric or specific terms
        like_clauses = []
        like_params = []
        for rt in list(rare_tokens)[:5]:
            like_clauses.append("title LIKE ? OR subtitle LIKE ? OR narrative LIKE ? OR facts LIKE ?")
            like_params.extend([f"%{rt}%"] * 4)
        
        obs_query = ""
        params = []
        if rowids:
            placeholders = ','.join('?' for _ in rowids)
            obs_query = f"SELECT id, project, title, subtitle, narrative, facts, created_at FROM observations WHERE id IN ({placeholders})"
            params = rowids
        elif like_clauses:
            obs_query = f"SELECT id, project, title, subtitle, narrative, facts, created_at FROM observations WHERE {' OR '.join(like_clauses)} LIMIT 100"
            params = like_params

        if obs_query:
            c.execute(obs_query, params)
            obs_scored = []
            for r in c.fetchall():
                proj = r['project'] or ''
                if args.project and args.project not in proj and proj not in args.project:
                    continue
                full_text = f"{r['title'] or ''} {r['subtitle'] or ''} {r['narrative'] or ''} {r['facts'] or ''}".lower()
                matched = [t for t in tokens if t in full_text]
                if not matched:
                    continue
                score = sum(3 if t in rare_tokens else 1 for t in matched)
                if args.project and (args.project in proj or proj in args.project):
                    score += 3
                
                # Format clean snippet
                snippet = r['title'] or ''
                if r['subtitle']:
                    snippet += f" - {r['subtitle']}"
                if r['facts']:
                    try:
                        facts_list = json.loads(r['facts'])
                        if isinstance(facts_list, list) and facts_list:
                            snippet += f" | Facts: {'; '.join(facts_list[:2])}"
                    except Exception:
                        snippet += f" | Facts: {r['facts'][:150]}"

                obs_scored.append({
                    "id": r['id'],
                    "project": proj,
                    "title": r['title'],
                    "snippet": snippet[:400],
                    "matched_tokens": matched,
                    "date": r['created_at'],
                    "score": score
                })
            obs_scored.sort(key=lambda x: (x['score'], x['date']), reverse=True)
            out["observations"] = obs_scored[:args.limit]
    except Exception as e:
        out["obs_error"] = str(e)

    # 2. Search Tool Uses (Bash executions, tests, probe runs)
    try:
        # Search recent tool uses matching key tokens
        tool_like_clauses = []
        tool_params = []
        for t in list(rare_tokens)[:6]:
            tool_like_clauses.append("tool_input LIKE ? OR tool_response LIKE ?")
            tool_params.extend([f"%{t}%", f"%{t}%"])
        
        if tool_like_clauses:
            tool_query = f"""
            SELECT id, project, tool_name, tool_input, tool_response, created_at 
            FROM tool_uses 
            WHERE ({' OR '.join(tool_like_clauses)})
              AND (tool_name NOT LIKE '%anchor-lab-ai%' AND tool_name NOT LIKE '%deep_sweep%' AND tool_name NOT LIKE '%reconcile%')
              AND (tool_input NOT LIKE '%mcp__plugin_anchor-lab-ai%' AND tool_input NOT LIKE '%lab_deep_sweep%')
            ORDER BY id DESC LIMIT 150
            """
            c.execute(tool_query, tool_params)
            tool_scored = []
            for r in c.fetchall():
                proj = r['project'] or ''
                if args.project and args.project not in proj and proj not in args.project:
                    continue
                inp_raw = r['tool_input'] or ''
                out_raw = r['tool_response'] or ''
                full_text = f"{inp_raw} {out_raw}".lower()
                matched = [t for t in tokens if t in full_text]
                if not matched:
                    continue
                score = sum(3 if t in rare_tokens else 1 for t in matched)
                
                # Extract command and stdout
                cmd = ''
                stdout = ''
                try:
                    inp_obj = json.loads(inp_raw)
                    cmd = inp_obj.get('command', '')
                except Exception:
                    cmd = inp_raw[:150]

                try:
                    out_obj = json.loads(out_raw)
                    stdout = out_obj.get('stdout', '') or out_obj.get('stderr', '')
                except Exception:
                    stdout = out_raw[:300]

                tool_scored.append({
                    "id": r['id'],
                    "project": proj,
                    "tool": r['tool_name'],
                    "command": cmd[:200],
                    "output_snippet": stdout.strip().replace("\n", " ")[:300],
                    "matched_tokens": matched,
                    "date": r['created_at'],
                    "score": score
                })
            tool_scored.sort(key=lambda x: (x['score'], x['date']), reverse=True)
            out["tool_uses"] = tool_scored[:args.limit]
    except Exception as e:
        out["tool_error"] = str(e)

    # 3. Search Session Summaries
    try:
        sum_like = []
        sum_params = []
        for t in list(rare_tokens)[:5]:
            sum_like.append("request LIKE ? OR completed LIKE ? OR learned LIKE ? OR notes LIKE ?")
            sum_params.extend([f"%{t}%"] * 4)
        
        if sum_like:
            sum_query = f"""
            SELECT id, project, request, completed, learned, notes, created_at 
            FROM session_summaries 
            WHERE {' OR '.join(sum_like)}
            ORDER BY id DESC LIMIT 50
            """
            c.execute(sum_query, sum_params)
            sum_scored = []
            for r in c.fetchall():
                proj = r['project'] or ''
                if args.project and args.project not in proj and proj not in args.project:
                    continue
                full_text = f"{r['request'] or ''} {r['completed'] or ''} {r['learned'] or ''} {r['notes'] or ''}".lower()
                matched = [t for t in tokens if t in full_text]
                if not matched:
                    continue
                score = sum(3 if t in rare_tokens else 1 for t in matched)
                
                sum_scored.append({
                    "id": r['id'],
                    "project": proj,
                    "request": (r['request'] or '')[:150],
                    "completed": (r['completed'] or '')[:200],
                    "learned": (r['learned'] or '')[:200],
                    "matched_tokens": matched,
                    "date": r['created_at'],
                    "score": score
                })
            sum_scored.sort(key=lambda x: (x['score'], x['date']), reverse=True)
            out["session_summaries"] = sum_scored[:args.limit]
    except Exception as e:
        out["sum_error"] = str(e)

    print(json.dumps(out))

if __name__ == '__main__':
    main()
