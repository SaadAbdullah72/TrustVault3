from algokit_utils import AppCreateParams
import inspect

print("Fields of AppCreateParams:")
try:
    print(inspect.signature(AppCreateParams))
except Exception as e:
    print(e)
