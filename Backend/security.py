import hashlib

def _prehash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def hash_password(password: str) -> str:
    return _prehash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _prehash(plain_password) == hashed_password
