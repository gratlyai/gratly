#!/usr/bin/env python3
import requests
import json
import configparser
import mysql.connector
import os
from datetime import datetime, date, time, timedelta,timezone
import pytz
from zoneinfo import ZoneInfo

def log(message):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {message}", flush=True)

def load_config(path):
    """
    Reads configuration from a specified file.
    """
    config = configparser.ConfigParser()
    config.read(path)
    return config

def convert_utc_pacific(utc_dt):
    if utc_dt is None:
        return None

    # Replace '+0000' or '-0000' with '+00:00' or '-00:00'
    if isinstance(utc_dt, str):
        # Fix timezone format
        if len(utc_dt) > 5 and (utc_dt[-5] in ['+', '-']) and utc_dt[-5:] not in ['+00:00', '-00:00']:
            utc_dt = utc_dt[:-2] + ':' + utc_dt[-2:]
        utc_dt = datetime.fromisoformat(utc_dt)

    # If naive → assume UTC
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo("UTC"))

    # Convert to Pacific
    return utc_dt.astimezone(ZoneInfo("America/Los_Angeles"))
        
def convert_pacific_utc(dt):
    """
    Convert a datetime (naive or aware) in Pacific time to UTC
    and return formatted as 'YYYY-MM-DDTHH:MM:SS.000-0000'.
    """
    pacific_tz = pytz.timezone('US/Pacific')

    # If string is passed, try parsing full datetime
    if isinstance(dt, str):
        # Try parsing with full datetime first
        try:
            dt = datetime.strptime(dt, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            # fallback to just date
            dt = datetime.strptime(dt, '%Y-%m-%d')

    # If naive, localize to Pacific
    if dt.tzinfo is None:
        dt = pacific_tz.localize(dt)

    # Convert to UTC
    dt_utc = dt.astimezone(pytz.utc)

    return dt_utc.strftime('%Y-%m-%dT%H:%M:%S.000-0000')

def normalize_business_date(date_value):
    if not date_value:
        return None
    if isinstance(date_value, datetime):
        return date_value.date().strftime('%Y-%m-%d')
    if isinstance(date_value, date):
        return date_value.strftime('%Y-%m-%d')
    if isinstance(date_value, str):
        stripped = date_value.strip()
        if "-" in stripped:
            return stripped
        if len(stripped) == 8 and stripped.isdigit():
            return f"{stripped[:4]}-{stripped[4:6]}-{stripped[6:]}"
    return str(date_value)



# Get all parameters for dates to be passed in APIs

start_date_time = datetime.combine(date.today(), time(0, 0, 1))  # 00:00:01
# start_date = convert_pacific_utc(start_date_time.strftime('%Y-%m-%d %H:%M:%S'))
start_date = convert_pacific_utc('2025-12-17 00:00:01')
end_datetime = datetime.combine(date.today(), time(23, 59, 59))
# end_date = convert_pacific_utc(end_datetime.strftime('%Y-%m-%d %H:%M:%S'))
end_date = convert_pacific_utc('2025-12-17 23:59:59')
business_date = '20251217'
# business_date = date.today().strftime('%Y%m%d')
print(start_date,end_date,business_date)

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, 'setting.ini')
    config = load_config(config_path)
    log(f"Loaded config from {config_path}")
    
    # Database connection details
    db_config = {
        'host': config['DATABASE']['host'],
        'user': config['DATABASE']['user'],
        'password': config['DATABASE']['password'],
        'database': config['DATABASE']['database']
    }
    
    # Get all the URLs from the setting.ini 
    
    urls = config['URLS']['url']
    delimiter = ','
    all_url = urls.split(delimiter)
    
    # Initiate the MySQL connection
    
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT RESTAURANTGUID,SECRETKEY,CLIENTSECRET,USERACCESSTYPE from GRATLYDB.SRC_ONBOARDING")
    get_results = cursor.fetchall()
    if not get_results:
        log("No rows found in GRATLYDB.SRC_ONBOARDING. Exiting.")
        return
    
    for row in get_results:
        payload = {
        "clientId": row['SECRETKEY'],
        "clientSecret": row['CLIENTSECRET'],
        "userAccessType": row['USERACCESSTYPE']
        }
        headers_init = row['RESTAURANTGUID']
        headers = {"Content-Type": "application/json"}
        authurl = 'https://ws-api.toasttab.com/authentication/v1/authentication/login'
        response = requests.post(authurl, json=payload, headers=headers)
        if response.status_code != 200:
            log(f"Auth failed for restaurant {headers_init}: {response.status_code} {response.text}")
            continue
        
        data = response.json()

        pretty_json_output = json.dumps(data, indent=4)
        access_token = json.loads(pretty_json_output)
        if 'token' not in access_token or 'accessToken' not in access_token['token']:
            log(f"Auth token missing for restaurant {headers_init}: {pretty_json_output}")
            continue
        accesstoken = f"Bearer {access_token['token']['accessToken']}"
        
        headers = {
        "Toast-Restaurant-External-ID": headers_init,
        "Authorization": accesstoken
        }
                

        for url in all_url:
            # print(f"URL IS {url}")
    
            if url == 'https://ws-api.toasttab.com/restaurants/v1/restaurants/':
                url = f"{url}{headers_init}"
                # print(f"URL IS {url}")
                response = requests.get(url, headers=headers)
                if response.status_code != 200:
                    log(f"Restaurant API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()
                
                # pretty_json_output = json.dumps(data, indent=4)
                # with open('getrestaurantdetails.json', 'w') as json_file:
                    # json_file.write(pretty_json_output)
                    
                # SQL query to insert data
                restaurant_sql_query = "INSERT INTO GRATLYDB.SRC_RESTAURANTDETAILS (RESTAURANTGUID,RESTAURANTNAME,LOCATIONNAME,LOCATIONCODE,DESCRIPTION,TIMEZONE,CURRENCYCODE,FIRSTBUSINESSDATE,ARCHIVED,ADDRESS1,ADDRESS2,CITY,STATECODE,ZIPCODE,COUNTRY,PHONE,WEBSITE,ORDERONLINE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                restaurant_sql_data = [(headers_init,data['general']['name'],data['general']['locationName'],data['general']['locationCode'],data['general']['description'],data['general']['timeZone'],data['general']['currencyCode'],data['general']['firstBusinessDate'],data['general']['archived'],data['location']['address1'],data['location']['address2'],
                                        data['location']['city'],data['location']['stateCode'],data['location']['zipCode'],data['location']['country'],data['location']['phone'],data['urls']['website'],data['urls']['orderOnline'])]

                try:
                    cursor.executemany(restaurant_sql_query, restaurant_sql_data)
                    conn.commit()
                    log(f"Inserted restaurant details for {headers_init}")
                except Exception as e:
                    log(f"Insert restaurant details failed for {headers_init}: {e}")
                    conn.rollback()
            
            if url == 'https://ws-api.toasttab.com/labor/v1/jobs':
                response = requests.get(url, headers=headers)
                if response.status_code != 200:
                    log(f"Jobs API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()    
                if not data:
                    log(f"No jobs returned for {headers_init}")
                    continue
                
                # SQL query to insert data
                jobs_sql_query = "INSERT INTO GRATLYDB.SRC_JOBS(RESTAURANTGUID,JOBGUID,JOBTITLE,ENTITYTYPE,CREATEDDATE,DELETED,DELETEDDATE,CODE,TIPPED,DEFAULTWAGE,WAGEFREQUENCY) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                jobs_sql_data = [(headers_init,record['guid'],record['title'],record['entityType'],record['createdDate'][0:10],record['deleted'],record['deletedDate'][0:10],record['code'],record['tipped'],record['defaultWage'],record['wageFrequency']) for record in data]

                try:
                    cursor.executemany(jobs_sql_query, jobs_sql_data)
                    conn.commit()
                    log(f"Inserted {len(jobs_sql_data)} jobs for {headers_init}")
                except Exception as e:
                    log(f"Insert jobs failed for {headers_init}: {e}")
                    conn.rollback()   
                
            if url == 'https://ws-api.toasttab.com/labor/v1/employees':
                response = requests.get(url, headers=headers)
                if response.status_code != 200:
                    log(f"Employees API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()    
                if not data:
                    log(f"No employees returned for {headers_init}")
                    continue
                
                # SQL query to insert data
                employees_sql_query = "INSERT INTO GRATLYDB.SRC_EMPLOYEES (RESTAURANTGUID,EMPLOYEEGUID,EMPLOYEEFNAME,EMPLOYEELNAME,CHOSENNAME,PHONENUMBER,EMAIL,DELETED,DELETEDDATE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                employees_sql_data = [(headers_init,record['guid'],record['firstName'],record['lastName'],record['chosenName'],record['phoneNumber'],record['email'],record['deleted'],record['deletedDate'][0:10]) for record in data]

                try:
                    cursor.executemany(employees_sql_query, employees_sql_data)
                    conn.commit()
                    log(f"Inserted {len(employees_sql_data)} employees for {headers_init}")
                except Exception as e:
                    log(f"Insert employees failed for {headers_init}: {e}")
                    conn.rollback()    
                
                # Prepare data for insertion (list of tuples)
                employeejobs_to_insert = []
                
                # SQL query to insert data
                employee_job_sql_query = "INSERT INTO GRATLYDB.SRC_EMPLOYEEROLE(RESTAURANTGUID,EMPLOYEEGUID,NAME,JOBGUID) VALUES (%s, %s, %s, %s)"
                
                for record in data:
                    restaurantID = headers_init
                    employeeID = record['guid']
                    name = record['firstName'] + ' ' + record['lastName']
                    for job in record['jobReferences']:
                        if job['guid'] is None:
                            jobID = 'N/A'
                        else:
                            jobID = job['guid']
                        employeejobs_to_insert.append([restaurantID,employeeID,name,jobID])
                        
                try:
                    cursor.executemany(employee_job_sql_query, employeejobs_to_insert)
                    conn.commit()
                    log(f"Inserted {len(employeejobs_to_insert)} employee roles for {headers_init}")
                except Exception as e:
                    log(f"Insert employee roles failed for {headers_init}: {e}")
                    conn.rollback()    
                
            if url == 'https://ws-api.toasttab.com/labor/v1/timeEntries':
                
                query = {
                    "startDate": start_date,
                    "endDate": end_date,
                    "includeArchived": "true",
                    "includeMissedBreaks": "true"
                    }
                response = requests.get(url, headers=headers, params=query)
                if response.status_code != 200:
                    log(f"Time entries API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()   
                if not data:
                    log(f"No time entries returned for {headers_init} ({start_date} to {end_date})")
                    continue
                 
                timeentries_sql_data = []
                
                # SQL query to insert data
                timeentries_sql_query = """INSERT INTO GRATLYDB.SRC_TIMEENTRIES(RESTAURANTGUID,TIMEENTRYGUID,ENTITYTYPE,EXTERNALID,EMPLOYEEGUID,JOBID,SHIFTREFERENCE,INDATE,OUTDATE,
                                        BUSINESSDATE,REGULARHOURS,OVERTIMEHOURS,HOURLYWAGE,TIPSWITHHELD,NONCASHSALES,CASHSALES,NONCASHGRATUITYSERVICECHARGES,CASHGRATUITYSERVICECHARGES,
                                        NONCASHTIPS,DECLAREDCASHTIPS,AUTOCLOCKEDOUT,DELETED,CREATEDDATE,MODIFIEDDATE,DELETEDDATE) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                

                timeentries_sql_data = [(headers_init,record['guid'],record['entityType'],record['externalId'],record['employeeReference']['guid'],record['jobReference']['guid'],record['shiftReference'],
                                                convert_utc_pacific(record['inDate']),convert_utc_pacific(record['outDate']),normalize_business_date(record['businessDate']),record['regularHours'],record['overtimeHours'],record['hourlyWage'],
                                                record['tipsWithheld'],record['nonCashSales'],record['cashSales'],record['nonCashGratuityServiceCharges'],record['cashGratuityServiceCharges'],record['nonCashTips'],
                                                record['declaredCashTips'],record['autoClockedOut'],record['deleted'],record['createdDate'],record['modifiedDate'],record.get('deletedDate',None)) for record in data]
                
                try:
                    cursor.executemany(timeentries_sql_query, timeentries_sql_data)
                    conn.commit()
                    log(f"Inserted {len(timeentries_sql_data)} time entries for {headers_init}")
                except Exception as e:
                    log(f"Insert time entries failed for {headers_init}: {e}")
                    conn.rollback()   
                    
            if url == 'https://ws-api.toasttab.com/config/v2/tables':
                        
                response = requests.get(url, headers=headers)
                if response.status_code != 200:
                    log(f"Tables API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()    
                if not data:
                    log(f"No tables returned for {headers_init}")
                    continue
                
                # SQL query to insert data
                tables_sql_query = "INSERT INTO GRATLYDB.SRC_TABLES(RESTAURANTGUID,TABLEGUID,ENTITYTYPE,TABLENAME) VALUES (%s, %s, %s, %s)"
                
                tables_sql_data = [(headers_init,record['guid'],record['entityType'],record['name']) for record in data]
                        
                try:
                    cursor.executemany(tables_sql_query, tables_sql_data)
                    conn.commit()
                    log(f"Inserted {len(tables_sql_data)} tables for {headers_init}")
                except Exception as e:
                    log(f"Insert tables failed for {headers_init}: {e}")
                    conn.rollback()   
                
            if url == 'https://ws-api.toasttab.com/orders/v2/ordersBulk':
                query = {
                        "businessDate": business_date
                        }
                response = requests.get(url, headers=headers, params=query)
                if response.status_code != 200:
                    log(f"Orders API failed for {headers_init}: {response.status_code} {response.text}")
                    continue
                data = response.json()    
                if not data:
                    log(f"No orders returned for {headers_init} (businessDate {business_date})")
                    continue
                
                all_orders_sql_data = []
                
                # SQL query to insert data
                all_orders_sql_query = """INSERT INTO GRATLYDB.SRC_ALLORDERS(RESTAURANTGUID,ORDERGUID,DISPLAYNUMBER,BUSINESSDATE,ORDERSOURCE,TABLEGUID,ORDERPAIDDATE,VOIDED,OPENEDDATE,PREPTIME,PAYMENTTYPE,REFUNDSTATUS,PAYMENTSTATUS,NETAMOUNT,
                                                    TIPAMOUNT,GRATUITYAMOUNT,TAXAMOUNT,TOTALAMOUNT,EMPLOYEEGUID,NUMBEROFGUESTS,DURATION,APPROVALSTATUS) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
                
                for record in data:
                    restaurantID = headers_init
                    orderID = record.get("guid")
                    displayNumber = record.get("displayNumber")
                    businessDate = normalize_business_date(record.get("businessDate"))
                    orderSource = record.get("source")

                    tableID = None
                    if record.get("table"):
                        tableID = record["table"].get("guid")

                    openedDate = convert_utc_pacific(record.get("openedDate"))
                    voided = record.get("voided")
                    prepTime = record.get("requiredPrepTime")
                    numberOfGuests = record.get("numberOfGuests")
                    duration = record.get("duration")
                    approvalStatus = record.get("approvalStatus")

                    employeeID = None
                    if record.get("server"):
                        employeeID = record["server"].get("guid")

                    # ---- SAFE CHECK / PAYMENT HANDLING ----
                    checks = record.get("checks") or []

                    paymentStatus = ""
                    paymentType = ""
                    refundStatus = ""
                    netAmount = 0.0
                    tipAmount = 0.0
                    gratuityamount = 0.0
                    taxAmount = 0.0
                    totalAmount = 0.0
                    orderPaidDate = None

                    if checks:
                        check = checks[0]
                        paymentStatus = check.get("paymentStatus", "")
                        taxAmount = check.get("taxAmount", 0.0)
                        totalAmount = check.get("totalAmount", 0.0)

                        payments = check.get("payments") or []
                        if payments:
                            for payment in payments:
                            # payment = payments[0]
                                paymentType = paymentType + payment.get("type", "")
                                refundStatus = payment.get("refundStatus", "")
                                netAmount = netAmount + payment.get("amount", 0.0)
                                tipAmount = tipAmount + payment.get("tipAmount", 0.0)
                            
                        appsvccharges = check.get("appliedServiceCharges") or {}
                        if appsvccharges:
                            appsvccharge = appsvccharges[0]
                            gratuityamount = appsvccharge.get("chargeAmount", "")

                        if paymentStatus != "OPEN":
                            orderPaidDate = convert_utc_pacific(record.get("paidDate"))

                    all_orders_sql_data.append([restaurantID,orderID,displayNumber,businessDate,orderSource,tableID,orderPaidDate,voided,openedDate,prepTime,paymentType,refundStatus,paymentStatus,netAmount,
                                                        tipAmount,gratuityamount,taxAmount,totalAmount,employeeID,numberOfGuests,duration,approvalStatus])

                # all_orders_sql_data = [(headers_init,record['guid'],record['displayNumber'],record['businessDate'],record['source'],convert_utc_pacific(record['paidDate']),record['voided'],convert_utc_pacific(record['openedDate']),
                                        # record['requiredPrepTime'],record['checks']['payments']['type'],record['checks']['payments']['refundStatus'],record['checks']['paymentStatus'],record['checks']['payments']['amount'],
                                        # record['checks']['payments']['tipAmount'],record['checks']['taxAmount'],record['checks']['totalAmount'],record['server']['guid'],record['numberOfGuests'],record['duration'],record['approvalStatus']) for record in data]

                try:
                    cursor.executemany(all_orders_sql_query, all_orders_sql_data)
                    conn.commit()
                    log(f"Inserted {len(all_orders_sql_data)} orders for {headers_init}")
                except Exception as e:
                    log(f"Insert orders failed for {headers_init}: {e}")
                    conn.rollback()   
                              
                
        if conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    main()
