from getalldata import main


def handler(event, context):
   days_back = None
   if isinstance(event, dict):
       days_back = event.get("days_back") or event.get("DAYS_BACK")
   main(days_back=days_back)
   return {"status": "ok"}
