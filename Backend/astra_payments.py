from typing import Any, Dict


def _create_restaurant_debit_for_settlement(
    settlement_id: str,
    restaurant_id: int,
    business_date: str,
) -> Dict[str, Any]:
    raise RuntimeError(
        "Astra payments not configured yet. Provide Astra API docs to implement."
    )

