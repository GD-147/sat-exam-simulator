import re
import json
import argparse
from pathlib import Path

ID_RE = re.compile(r"^(?P<prefix>[A-Z]+)(?P<exam>\d+)-(?P<module>M[12])-(?P<num>\d{3})\s*$")
OPT_RE = re.compile(r"^([ABCD])\)\s*(.*)\s*$")
KEY_START_RE = re.compile(
    r"^(?P<id>[A-Z]+\d+-M[12]-\d{3})\s*[-–—]+\s*Correct:\s*(?P<correct>.+?)\s*[-–—]+\s*Explanation:\s*(?P<exp>.*)\s*$"
)

SECTION_MAP = {
    "RW": {
        "base": "reading_writing",
        "expected_m1": 27,
        "expected_m2": 27,
    },
    "MATH": {
        "base": "math",
        "expected_m1": 22,
        "expected_m2": 22,
    },
}

def norm(s):
    s = s.replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = re.sub(r"\s+", " ", s.strip())
    return s.casefold()

def split_questions_and_key(lines):
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
            if cur_id and line.strip():
                cur_exp_parts.append(line.strip())

    flush()
    return key_map

def clean_prompt_parts(prompt_parts):
    cleaned = []

    for idx, part in enumerate(prompt_parts):
        raw = part.rstrip()
        stripped = raw.strip()
        low = stripped.lower()

        if idx == 0 and low.startswith("prompt:"):
            rest = raw.split(":", 1)[1].lstrip()
            if rest:
                cleaned.append(rest)
            continue

        if low == "question:":
            continue

        if low.startswith("question:"):
            rest = raw.split(":", 1)[1].lstrip()
            if rest:
                cleaned.append(rest)
            continue

        cleaned.append(raw)

    return "\n".join(cleaned).strip()

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

        prompt_parts = []
        while i < len(q_lines):
            l = q_lines[i].rstrip("\n")
            if OPT_RE.match(l.strip()):
                break
            prompt_parts.append(l)
            i += 1

        prompt = clean_prompt_parts(prompt_parts)

        choices = {}
        for expected in ["A", "B", "C", "D"]:
            if i >= len(q_lines):
                raise ValueError(f"Missing option {expected}) for {qid}")
            m = OPT_RE.match(q_lines[i].strip("\n"))
            if not m or m.group(1) != expected:
                raise ValueError(f"Expected {expected}) for {qid}, got: {q_lines[i].strip()}")
            choices[expected] = m.group(2).strip()
            i += 1

        questions.append({
            "id": qid,
            "prompt": prompt,
            "choices": choices,
        })

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
        found = None

        if correct_text in q["choices"]:
            found = correct_text
        else:
            for letter, opt_text in q["choices"].items():
                if norm(opt_text) == norm(correct_text):
                    found = letter
                    break

        if not found:
            mismatched.append((qid, correct_text, q["choices"]))
            found = "A"

        q["correct"] = found
        q["explanation"] = exp
        out.append(q)

    return out, missing_keys, mismatched

def parse_id(qid):
    m = ID_RE.match(qid)
    if not m:
        raise ValueError(f"Unrecognized ID format: {qid}")
    return {
        "prefix": m.group("prefix"),
        "exam": int(m.group("exam")),
        "module": m.group("module"),
        "num": int(m.group("num")),
    }

def split_by_module(questions):
    if not questions:
        raise ValueError("No questions parsed from source file")

    parsed = [parse_id(q["id"]) for q in questions]

    prefixes = {p["prefix"] for p in parsed}
    exams = {p["exam"] for p in parsed}

    if len(prefixes) != 1:
        raise ValueError(f"Mixed prefixes found in one file: {sorted(prefixes)}")
    if len(exams) != 1:
        raise ValueError(f"Mixed exam numbers found in one file: {sorted(exams)}")

    prefix = next(iter(prefixes))
    exam_num = next(iter(exams))

    if prefix not in SECTION_MAP:
        raise ValueError(f"Unsupported SAT section prefix: {prefix}")

    module_1 = []
    module_2 = []

    for q in questions:
        info = parse_id(q["id"])
        if info["module"] == "M1":
            module_1.append((info["num"], q))
        elif info["module"] == "M2":
            module_2.append((info["num"], q))
        else:
            raise ValueError(f"Unexpected module in ID: {q['id']}")

    module_1 = [q for _, q in sorted(module_1, key=lambda x: x[0])]
    module_2 = [q for _, q in sorted(module_2, key=lambda x: x[0])]

    return prefix, exam_num, module_1, module_2

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--infile", required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()

    txt = Path(args.infile).read_text(encoding="utf-8", errors="replace")
    lines = txt.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    q_lines, key_lines = split_questions_and_key(lines)
    questions = parse_questions(q_lines)
    key_map = parse_key_blocks(key_lines)

    merged, missing_keys, mismatched = attach_answers(questions, key_map)

    prefix, exam_num, module_1, module_2 = split_by_module(merged)
    section_info = SECTION_MAP[prefix]

    expected_m1 = section_info["expected_m1"]
    expected_m2 = section_info["expected_m2"]

    if len(module_1) != expected_m1:
        print(f"WARNING: expected {expected_m1} questions in Module 1, found {len(module_1)}")
    if len(module_2) != expected_m2:
        print(f"WARNING: expected {expected_m2} questions in Module 2, found {len(module_2)}")

    if missing_keys:
        print("WARNING: Missing key entries for:", ", ".join(missing_keys[:20]), ("..." if len(missing_keys) > 20 else ""))
    if mismatched:
        print("WARNING: Correct text did not match any option for these items:")
        for qid, correct_text, choices in mismatched[:10]:
            print(f"  {qid} | Correct text in key: {correct_text!r} | Options: {choices}")
        if len(mismatched) > 10:
            print("  ...")

    exam_str = f"{exam_num:02d}"
    outdir = Path(args.outdir)

    out_m1 = outdir / f"{section_info['base']}_module_1_exam_{exam_str}.json"
    out_m2 = outdir / f"{section_info['base']}_module_2_exam_{exam_str}.json"

    write_json(out_m1, module_1)
    write_json(out_m2, module_2)

    print(f"OK: wrote {len(module_1)} questions to {out_m1}")
    print(f"OK: wrote {len(module_2)} questions to {out_m2}")

if __name__ == "__main__":
    main()
