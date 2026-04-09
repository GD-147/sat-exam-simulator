import re, json, argparse
from pathlib import Path

ID_RE = re.compile(r"^[A-Z]{1,2}\d-\d{3}\s*$")
OPT_RE = re.compile(r"^([ABCD])\)\s*(.*)\s*$")
KEY_START_RE = re.compile(r"^(?P<id>[A-Z]{1,2}\d-\d{3})\s*[-–—�?]+\s*Correct:\s*(?P<correct>.+?)\s*[-–—�?]+\s*Explanation:\s*(?P<exp>.*)\s*$")

def norm(s: str) -> str:
    s = s.replace("\u2019","'").replace("\u201c",'"').replace("\u201d",'"')
    s = s.replace("\u2013","-").replace("\u2014","-")
    s = re.sub(r"\s+", " ", s.strip())
    return s.casefold()

def split_questions_and_key(lines):
    # Find first key line
    key_idx = None
    for i, line in enumerate(lines):
        if KEY_START_RE.match(line.strip()):
            key_idx = i
            break
    if key_idx is None:
        return lines, []
    return lines[:key_idx], lines[key_idx:]

def parse_key_blocks(key_lines):
    key_map = {}
    cur_id = None
    cur_correct = None
    cur_exp_parts = []

    def flush():
        nonlocal cur_id, cur_correct, cur_exp_parts
        if cur_id:
            key_map[cur_id] = (cur_correct or "", "\n".join(cur_exp_parts).strip())
        cur_id = None
        cur_correct = None
        cur_exp_parts = []

    for raw in key_lines:
        line = raw.rstrip("\n")
        m = KEY_START_RE.match(line.strip())
        if m:
            flush()
            cur_id = m.group("id").strip()
            cur_correct = m.group("correct").strip()
            exp0 = m.group("exp").strip()
            if exp0:
                cur_exp_parts.append(exp0)
        else:
            # continuation lines for explanation
            if cur_id and line.strip():
                cur_exp_parts.append(line.strip())

    flush()
    return key_map

def parse_questions(q_lines):
    i = 0
    questions = []

    while i < len(q_lines):
        line = q_lines[i].strip("\n")
        if not ID_RE.match(line.strip()):
            i += 1
            continue

        qid = line.strip()
        i += 1

        # collect prompt until first option A)
        prompt_parts = []
        while i < len(q_lines):
            l = q_lines[i].rstrip("\n")
            if OPT_RE.match(l.strip()):
                break
            prompt_parts.append(l)
            i += 1

        # clean leading "Prompt:" label if present
        if prompt_parts and prompt_parts[0].strip().lower().startswith("prompt:"):
            prompt_parts[0] = prompt_parts[0].split(":", 1)[1].lstrip()

        prompt = "\n".join([p.rstrip() for p in prompt_parts]).strip()

        # parse options A-D
        choices = {}
        for expected in ["A","B","C","D"]:
            if i >= len(q_lines):
                raise ValueError(f"Missing option {expected}) for {qid}")
            m = OPT_RE.match(q_lines[i].strip("\n"))
            if not m or m.group(1) != expected:
                raise ValueError(f"Expected {expected}) for {qid}, got: {q_lines[i].strip()}")
            choices[expected] = m.group(2).strip()
            i += 1

        questions.append({"id": qid, "prompt": prompt, "choices": choices})

    return questions

def attach_answers(questions, key_map):
    missing_keys = []
    mismatched = []
    out = []

    for q in questions:
        qid = q["id"]
        if qid not in key_map:
            missing_keys.append(qid)
            q["correct"] = ""
            q["explanation"] = ""
            out.append(q)
            continue

        correct_text, exp = key_map[qid]
        # map correct_text to A-D
        found = None
        for letter, opt_text in q["choices"].items():
            if norm(opt_text) == norm(correct_text):
                found = letter
                break

        if not found:
            mismatched.append((qid, correct_text, q["choices"]))
            # fallback: keep A to avoid crash
            found = "A"

        q["correct"] = found
        q["explanation"] = exp
        out.append(q)

    return out, missing_keys, mismatched

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--infile", required=True)
    ap.add_argument("--outfile", required=True)
    ap.add_argument("--expected", type=int, default=None)
    args = ap.parse_args()

    txt = Path(args.infile).read_text(encoding="utf-8", errors="replace")
    # Normalize line endings
    lines = txt.replace("\r\n","\n").replace("\r","\n").split("\n")

    q_lines, key_lines = split_questions_and_key(lines)
    questions = parse_questions(q_lines)
    key_map = parse_key_blocks(key_lines)

    merged, missing_keys, mismatched = attach_answers(questions, key_map)

    if args.expected is not None and len(merged) != args.expected:
        print(f"WARNING: expected {args.expected} questions, found {len(merged)}")

    if missing_keys:
        print("WARNING: Missing key entries for:", ", ".join(missing_keys[:20]), ("..." if len(missing_keys)>20 else ""))
    if mismatched:
        print("WARNING: Correct text did not match any option for these items:")
        for qid, correct_text, choices in mismatched[:10]:
            print(f"  {qid} | Correct text in key: {correct_text!r} | Options: {choices}")
        if len(mismatched) > 10:
            print("  ...")

    out_path = Path(args.outfile)
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: wrote {len(merged)} questions to {out_path}")

if __name__ == "__main__":
    main()