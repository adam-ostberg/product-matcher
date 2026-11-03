"""
Some examples of how to use:

python download_data.py --list
python download_data.py --tables public.products coop.products
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path
from uuid import UUID
 
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
 
OUT_DIR = Path("data")
 
 
def get_engine():
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL not set. Put it in a .env file next to this script.")
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return create_engine(url)
 
 
def list_tables(engine, schema="public"):
    return pd.read_sql(
        text(
            """
            select table_name
            from information_schema.tables
            where table_schema = :schema and table_type = 'BASE TABLE'
            order by table_name
            """
        ),
        engine,
        params={"schema": schema},
    )["table_name"].tolist()
 
 
def print_overview(engine, schema="public"):
    columns = pd.read_sql(
        text(
            """
            select table_name, column_name, data_type
            from information_schema.columns
            where table_schema = :schema
            order by table_name, ordinal_position
            """
        ),
        engine,
        params={"schema": schema},
    )
    for table in list_tables(engine, schema):
        n = pd.read_sql(text(f'select count(*) as n from "{schema}"."{table}"'), engine)["n"][0]
        print(f"\n{table}  ({n:,} rows)")
        for _, row in columns[columns["table_name"] == table].iterrows():
            print(f"    {row['column_name']:<30} {row['data_type']}")
 
 
def make_parquet_safe(df):
    """Convert columns parquet can't store (dicts, lists, UUIDs) to strings."""
 
    def convert(value):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        if isinstance(value, UUID):
            return str(value)
        return value
 
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].map(convert)
    return df
 
 
def download_table(engine, table, out_dir, schema="public"):
    out_dir.mkdir(parents=True, exist_ok=True)
    df = pd.read_sql(text(f'select * from "{schema}"."{table}"'), engine)
    df = make_parquet_safe(df)
 
    # Schema is part of the file name so public.products and coop.products don't collide
    path = out_dir / f"{schema}_{table}_{date.today().isoformat()}.parquet"
    df.to_parquet(path, index=False)
 
    size_mb = path.stat().st_size / 1_000_000
    print(f"{schema}.{table}: {len(df):,} rows, {df.shape[1]} columns -> {path} ({size_mb:.1f} MB)")
    return df
 
 
def parse_table_arg(arg, default_schema):
    """'coop.products' -> ('coop', 'products'); 'products' -> (default_schema, 'products')."""
    if "." in arg:
        schema, table = arg.split(".", 1)
        return schema, table
    return default_schema, arg
 
 
def main():
    parser = argparse.ArgumentParser(description="Download Supabase tables to parquet.")
    parser.add_argument("--list", action="store_true", help="show tables and columns")
    parser.add_argument("--tables", nargs="+",
                        help="tables to download, as schema.table (e.g. public.products coop.products)")
    parser.add_argument("--schemas", nargs="+", default=["public", "coop"],
                        help="schemas to show with --list")
    parser.add_argument("--schema", default="public",
                        help="default schema for table names given without a schema prefix")
    parser.add_argument("--out", default=str(OUT_DIR), help="output directory")
    args = parser.parse_args()
 
    if not (args.list or args.tables):
        parser.print_help()
        return
 
    engine = get_engine()
 
    if args.list:
        for schema in args.schemas:
            print(f"\n===== schema: {schema} =====")
            print_overview(engine, schema)
        return
 
    targets = [parse_table_arg(t, args.schema) for t in args.tables]
    for schema, table in targets:
        available = list_tables(engine, schema)
        if table not in available:
            sys.exit(f"Unknown table {schema}.{table}\nAvailable in {schema}: {available}")
 
    for schema, table in targets:
        download_table(engine, table, Path(args.out), schema)
    print("Done.")
 
 
if __name__ == "__main__":
    main()